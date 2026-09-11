import { canonicalJson, exactKeys, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { GaslessHttps, type GaslessTransport } from "./https.js";
import { validateGaslessIntent } from "./intent-validation.js";
import type { GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessIntent, GaslessObservation } from "./model.js";
import { gaslessObservationRpcEnv, gaslessObservationSource } from "./observation-source.js";
import type { GaslessObservationPort, GaslessObservationRpcFactory } from "./ports.js";
import { recheckBlock, rpcJson, rpcQuantity, rpcRecord, type GaslessRpcCall, type GaslessRpcMethod } from "./rpc-codec.js";
import { observeGasless } from "./rpc-observe.js";
import { verifyProtocolAt } from "./rpc-state.js";
import { gaslessDeployment, gaslessProtocolHash } from "./registry.js";
import { gaslessChain, gaslessFailure, gaslessSame } from "./validation.js";

const READ_METHODS = new Set<GaslessRpcMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode",
  "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const MAX_RESPONSE = 2 * 1024 * 1024;

export function gaslessObservationRpcFactory(environment: Readonly<Record<string, string | undefined>>): GaslessObservationRpcFactory {
  const transport = new GaslessHttps();
  return (chainId, environmentName) => {
    const name = gaslessObservationRpcEnv(environmentName), rpcUrl = environment[name];
    if (rpcUrl === undefined || rpcUrl.length === 0) gaslessFailure("APN_RPC_CONFIG", "gasless_observation_rpc_missing");
    return new GaslessObservationRpc(chainId, rpcUrl, name, transport);
  };
}

/** One explicit observation source. No bundler, key, estimate or send capability exists here. */
export class GaslessObservationRpc implements GaslessObservationPort {
  readonly chainId: GaslessChainId;
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  private readonly endpoint: string;
  private readonly environmentName: string;
  private readonly deployment;
  private sequence = 0n;
  private readonly rpcCall: GaslessRpcCall;

  constructor(chainId: GaslessChainId, rpcUrl: string, environmentName: string,
    private readonly transport: GaslessTransport = new GaslessHttps()) {
    this.chainId = gaslessChain(chainId, "APN_RPC_CONFIG");
    this.environmentName = gaslessObservationRpcEnv(environmentName);
    this.deployment = gaslessDeployment(this.chainId);
    const endpoint = parsePublicHttpsUrl(rpcUrl, "APN_RPC_CONFIG", "Observation RPC endpoint", 2048);
    if (endpoint.search !== "" || endpoint.hash !== "") gaslessFailure("APN_RPC_CONFIG", "gasless_observation_rpc_endpoint");
    this.endpoint = endpoint.toString(); this.rpcOrigin = endpoint.origin; this.rpcEndpointHash = sha256(this.endpoint);
    this.rpcCall = async (method, params) => await this.call(method, params);
  }

  async observe(intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation> {
    validateGaslessIntent(intent);
    if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId ||
      intent.token !== this.deployment.token || intent.paymaster !== this.deployment.paymaster ||
      intent.entryPoint !== this.deployment.entryPoint || intent.delegate !== this.deployment.delegate ||
      intent.initialSnapshot.protocolHash !== gaslessProtocolHash(this.deployment) ||
      !gaslessSame(intent.tokenDomain, this.deployment.tokenDomain)) {
      gaslessFailure("APN_RPC_CONFIG", "gasless_observation_rpc_binding");
    }
    if (rpcQuantity(await this.rpcCall("eth_chainId", [])) !== BigInt(this.chainId)) {
      gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
    }
    // Validate the original anchor before accepting even partial scan progress from another provider.
    await recheckBlock(this.rpcCall, intent.initialSnapshot.block);
    await verifyProtocolAt(this.rpcCall, this.deployment, intent.initialSnapshot.block);
    const result = await observeGasless({ chainId: this.chainId, rpcOrigin: this.rpcOrigin,
      deployment: this.deployment, rpc: this.rpcCall }, intent, identity, cursor);
    await recheckBlock(this.rpcCall, intent.initialSnapshot.block);
    return { ...result, source: gaslessObservationSource(intent, this.environmentName, this) };
  }

  private async call(method: GaslessRpcMethod, params: readonly unknown[]): Promise<unknown> {
    if (!READ_METHODS.has(method)) gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_method");
    const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    let response;
    try { response = await this.transport.request(this.endpoint, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG"); }
    catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Observation RPC transport is unavailable."); }
    if (response.status !== 200) gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_http_status");
    const record = rpcRecord(rpcJson(response.body, MAX_RESPONSE));
    const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
    if (record.jsonrpc !== "2.0" || record.id !== id || result === error ||
      !exactKeys(record, result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
      gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_response");
    }
    if (error) gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_error");
    return record.result;
  }
}
