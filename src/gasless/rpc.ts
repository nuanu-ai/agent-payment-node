import { canonicalJson, exactKeys, hashObject, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address, Hex } from "../model.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { assertGaslessEstimate } from "./economics.js";
import { GaslessHttps, type GaslessTransport } from "./https.js";
import type { GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessEstimate, GaslessIntent,
  GaslessObservation, GaslessSnapshot } from "./model.js";
import type { GaslessBootstrapMaterial, GaslessRpcFactory, GaslessRpcPort, GaslessUserOperationMaterial } from "./ports.js";
import { observeGasless } from "./rpc-observe.js";
import { rpcAddress, rpcBlock, rpcHex, rpcJson, rpcQuantity, rpcRecord, recheckBlock,
  type GaslessRpcCall, type GaslessRpcMethod } from "./rpc-codec.js";
import { gasPrices, readAccountAt, readFeeConfigurationAt, verifyProtocolAt } from "./rpc-state.js";
import { gaslessDeployment, gaslessProtocolHash } from "./registry.js";
import { GASLESS_ESTIMATE_SIGNATURE, verifyGaslessBootstrap, verifyGaslessUserOperation } from "./signature.js";
import { gaslessChain, gaslessFailure, gaslessSame } from "./validation.js";
import { gaslessUserOperation, gaslessUserOperationHash, validateGaslessWire } from "./wire.js";

const RPC_METHODS = new Set<GaslessRpcMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode",
  "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_maxPriorityFeePerGas",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const BUNDLER_METHODS = new Set<GaslessRpcMethod>(["eth_chainId", "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas", "eth_sendUserOperation", "eth_getUserOperationReceipt", "eth_getUserOperationByHash"]);
const MAX_RESPONSE = 2 * 1024 * 1024;

export function gaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>): GaslessRpcFactory {
  const cache = new Map<GaslessChainId, GaslessRpcPort>(), transport = new GaslessHttps();
  return (chainId) => {
    const selected = gaslessChain(chainId, "APN_RPC_CONFIG"), existing = cache.get(selected);
    if (existing !== undefined) return existing;
    const deployment = gaslessDeployment(selected), rpcUrl = environment[deployment.rpcEnv];
    if (rpcUrl === undefined || rpcUrl.length === 0) gaslessFailure("APN_RPC_CONFIG", `missing_${deployment.rpcEnv}`);
    const configuredBundler = environment[deployment.bundlerEnv];
    const rpc = new GaslessRpc(selected, rpcUrl, configuredBundler === undefined || configuredBundler.length === 0
      ? undefined : configuredBundler, transport);
    cache.set(selected, rpc);
    return rpc;
  };
}

export class GaslessRpc implements GaslessRpcPort {
  readonly chainId: GaslessChainId;
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  readonly bundlerOrigin: string;
  readonly bundlerEndpointHash: string;
  private readonly rpcEndpoint: string;
  private readonly bundlerEndpoint: string;
  private readonly deployment;
  private sequence = 0n;
  private readonly rpcCall: GaslessRpcCall;
  private readonly bundlerCall: GaslessRpcCall;

  constructor(chainId: GaslessChainId, rpcUrl: string, bundlerUrl?: string, transport: GaslessTransport = new GaslessHttps()) {
    this.chainId = gaslessChain(chainId, "APN_RPC_CONFIG");
    this.deployment = gaslessDeployment(this.chainId);
    const rpc = endpoint(rpcUrl), bundler = endpoint(bundlerUrl ?? this.deployment.publicBundlerUrl);
    this.rpcEndpoint = rpc.toString(); this.bundlerEndpoint = bundler.toString();
    this.rpcOrigin = rpc.origin; this.bundlerOrigin = bundler.origin;
    this.rpcEndpointHash = sha256(this.rpcEndpoint); this.bundlerEndpointHash = sha256(this.bundlerEndpoint);
    this.rpcCall = async (method, params) => await this.call("rpc", method, params, transport);
    this.bundlerCall = async (method, params) => await this.call("bundler", method, params, transport);
  }

  async assertChain(): Promise<void> {
    const [rpcChain, bundlerChain, supported] = await Promise.all([
      this.rpcCall("eth_chainId", []), this.bundlerCall("eth_chainId", []),
      this.bundlerCall("eth_supportedEntryPoints", []),
    ]);
    if (rpcQuantity(rpcChain) !== BigInt(this.chainId) || rpcQuantity(bundlerChain) !== BigInt(this.chainId)) {
      gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
    }
    if (!Array.isArray(supported) || supported.length < 1 || supported.length > 16 ||
      !supported.some((value) => {
        try { return rpcAddress(value) === this.deployment.entryPoint; } catch { return false; }
      })) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_entrypoint_unavailable");
  }

  async snapshot(owner: Address): Promise<GaslessSnapshot> {
    await this.assertChain();
    const at = await rpcBlock(this.rpcCall, "latest");
    const [account, feeConfiguration, priority] = await Promise.all([
      readAccountAt(this.rpcCall, this.deployment, owner, at.block, true),
      readFeeConfigurationAt(this.rpcCall, this.deployment, owner, at.block),
      this.rpcCall("eth_maxPriorityFeePerGas", []),
      verifyProtocolAt(this.rpcCall, this.deployment, at.block),
    ]).then(([accountState, configuration, priorityFee]) => [accountState, configuration, priorityFee] as const);
    if (account.pendingEoaNonceAtomic !== account.eoaNonceAtomic) {
      gaslessFailure("APN_OPERATION_BLOCKED", "gasless_nonce_drift");
    }
    const prices = gasPrices(at.raw.baseFeePerGas, priority);
    await recheckBlock(this.rpcCall, at.block);
    return { chainId: this.chainId, rpcOrigin: this.rpcOrigin, rpcEndpointHash: this.rpcEndpointHash,
      bundlerOrigin: this.bundlerOrigin, bundlerEndpointHash: this.bundlerEndpointHash, block: at.block,
      protocolHash: gaslessProtocolHash(this.deployment), owner: account.owner, token: this.deployment.token,
      balanceAtomic: account.balanceAtomic, nativeBalanceWei: account.nativeBalanceWei,
      allowanceAtomic: account.allowanceAtomic, permitNonceAtomic: account.permitNonceAtomic,
      entryPointNonceAtomic: account.entryPointNonceAtomic, eoaNonceAtomic: account.eoaNonceAtomic,
      pendingEoaNonceAtomic: account.pendingEoaNonceAtomic, delegation: account.delegation, feeConfiguration, ...prices };
  }

  async estimate(intent: GaslessIntent, bootstrap: GaslessBootstrapMaterial): Promise<GaslessEstimate> {
    this.assertIntent(intent);
    await verifyGaslessBootstrap(intent, { permitSignature: bootstrap.permitSignature, authorization: bootstrap.authorization });
    await this.assertChain();
    const wire = gaslessUserOperation(intent, bootstrap, GASLESS_ESTIMATE_SIGNATURE);
    validateGaslessWire(intent, wire);
    const raw = rpcRecord(await this.bundlerCall("eth_estimateUserOperationGas", [wire, intent.entryPoint]));
    const fields = ["verificationGasLimit", "callGasLimit", "paymasterVerificationGasLimit",
      "paymasterPostOpGasLimit", "preVerificationGas"] as const;
    if (!exactKeys(raw, fields)) gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_estimate_bounds");
    const bounded = Object.fromEntries(fields.map((field) => [field, rpcQuantity(raw[field]).toString()])) as unknown as
      Omit<GaslessEstimate, "responseHash">;
    const estimate = { ...bounded, responseHash: hashObject(bounded) };
    assertGaslessEstimate(intent, estimate);
    return estimate;
  }

  async send(intent: GaslessIntent, sealed: GaslessUserOperationMaterial): Promise<Hex> {
    this.assertIntent(intent);
    const wire = validateGaslessWire(intent, sealed.userOperation);
    const localHash = gaslessUserOperationHash(intent, wire);
    if (sealed.userOperationHash !== localHash || await verifyGaslessUserOperation(intent, wire) !== localHash) {
      gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
    }
    await this.assertChain();
    try {
      const returned = rpcHex(await this.bundlerCall("eth_sendUserOperation", [wire, intent.entryPoint]), 32, 32);
      if (returned !== localHash) throw new Error("hash");
      return returned;
    } catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless submission state is unknown."); }
  }

  async observe(intent: GaslessIntent, identity: GaslessEffectIdentity,
    cursor: GaslessCursor): Promise<GaslessObservation> {
    this.assertIntent(intent);
    const rpcChain = await this.rpcCall("eth_chainId", []);
    if (rpcQuantity(rpcChain) !== BigInt(this.chainId)) gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
    return await observeGasless({ chainId: this.chainId, rpcOrigin: this.rpcOrigin, deployment: this.deployment,
      rpc: this.rpcCall, bundler: this.bundlerCall, snapshot: async (owner) => await this.snapshot(owner) }, intent, identity, cursor);
  }

  private assertIntent(intent: GaslessIntent): void {
    if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId ||
      intent.initialSnapshot.rpcOrigin !== this.rpcOrigin || intent.initialSnapshot.rpcEndpointHash !== this.rpcEndpointHash ||
      intent.initialSnapshot.bundlerOrigin !== this.bundlerOrigin || intent.initialSnapshot.bundlerEndpointHash !== this.bundlerEndpointHash) {
      gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
    }
    if (intent.token !== this.deployment.token || intent.paymaster !== this.deployment.paymaster ||
      intent.entryPoint !== this.deployment.entryPoint || intent.delegate !== this.deployment.delegate ||
      intent.initialSnapshot.protocolHash !== gaslessProtocolHash(this.deployment) ||
      !gaslessSame(intent.tokenDomain, this.deployment.tokenDomain)) {
      gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
    }
  }

  private async call(which: "rpc" | "bundler", method: GaslessRpcMethod, params: readonly unknown[],
    transport: GaslessTransport): Promise<unknown> {
    const methods = which === "rpc" ? RPC_METHODS : BUNDLER_METHODS;
    if (!methods.has(method)) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_method");
    const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    let response: { readonly status: number; readonly body: string };
    try {
      response = await transport.request(which === "rpc" ? this.rpcEndpoint : this.bundlerEndpoint,
        "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG");
    } catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable."); }
    if (response.status !== 200) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_HTTP_status");
    const record = rpcRecord(rpcJson(response.body, MAX_RESPONSE));
    const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
    const keys = result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
    if (record.jsonrpc !== "2.0" || record.id !== id || result === error || !exactKeys(record, keys)) {
      gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
    }
    if (error) gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_provider_response");
    return record.result;
  }
}

function endpoint(value: string): URL {
  const parsed = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Gasless RPC endpoint", 2048);
  if (parsed.search !== "" || parsed.hash !== "") gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
  return parsed;
}
