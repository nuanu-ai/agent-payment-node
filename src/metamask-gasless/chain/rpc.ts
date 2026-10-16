import { canonicalJson, exactKeys, sha256 } from "../../canonical.js";
import { parsePublicHttpsUrl } from "../../network-policy.js";
import { classifyX402LogAvailabilityMessage } from "../../rpc-envelope.js";
import type { ClockPort } from "../../ports.js";
import type { Address, Hex } from "../../model.js";
import { GaslessHttps, type GaslessTransport } from "../../gasless/https.js";
import { mmAssertStableQuote, mmQuote } from "../economics.js";
import type { MetaMaskGaslessBalance, MetaMaskGaslessChainId, MetaMaskGaslessChainState,
  MetaMaskGaslessCursor, MetaMaskGaslessIntent, MetaMaskGaslessProviderObservation,
  MetaMaskGaslessRpcObservation, MetaMaskGaslessSnapshot } from "../model.js";
import type { MetaMaskGaslessObservationRpcFactory, MetaMaskGaslessRpcFactory, MetaMaskGaslessRpcPort } from "../ports.js";
import { mmRegistry, MM_RPC_ENV } from "../registry.js";
import { mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";
import { mmEvidenceAt, mmEvidenceFail } from "./diagnostic.js";
import { mmValidateUnsigned } from "../unsigned.js";
import { mmObservedDeployment, mmRecordedDeployment } from "../recorded.js";
import { mmAddress, mmChain, mmHex, mmUint } from "../validation.js";
import { observeMetaMaskGasless } from "./observe.js";
import { recheckBlock, rpcBlock, rpcQuantity, rpcRecord, type MmRpcCall, type MmRpcMethod } from "./abi.js";
import { readMetaMaskChainState, validateMetaMaskGaslessSnapshot } from "./snapshot.js";

export { validateMetaMaskGaslessSnapshot } from "./snapshot.js";

const READ_METHODS = new Set<MmRpcMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_getCode",
  "eth_getStorageAt", "eth_call", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const MAX_RESPONSE = 4 * 1024 * 1024;

export interface MetaMaskGaslessRpcOptions {
  readonly chainId: MetaMaskGaslessChainId;
  readonly rpcUrl: string;
  readonly clock: ClockPort;
  readonly transport?: GaslessTransport;
  /** Observe saved operations only: prove the chain and the frozen anchor instead of the frozen endpoint identity. */
  readonly observationOnly?: boolean;
}

/** Lazy environment binding. Merely creating the factory performs no DNS, RPC, provider, or state I/O. */
export function metaMaskGaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>,
  clock: ClockPort, transport?: GaslessTransport): MetaMaskGaslessRpcFactory {
  const cache = new Map<MetaMaskGaslessChainId, MetaMaskGaslessRpcPort>();
  const selectedTransport = transport ?? new GaslessHttps();
  return (chainId) => {
    const selected = mmChain(chainId), existing = cache.get(selected);
    if (existing !== undefined) return existing;
    const name = MM_RPC_ENV[selected], rpcUrl = environment[name];
    if (rpcUrl === undefined || rpcUrl.length === 0) mmFail("mm_gasless_rpc_binding");
    const created = new MetaMaskGaslessRpc({ chainId: selected, rpcUrl, clock, transport: selectedTransport });
    cache.set(selected, created);
    return created;
  };
}

/** An owner-named RPC that observes saved operations only; it never serves approval-time balances or snapshots. */
export function metaMaskGaslessObservationRpcFactory(environment: Readonly<Record<string, string | undefined>>,
  clock: ClockPort, transport?: GaslessTransport): MetaMaskGaslessObservationRpcFactory {
  const selectedTransport = transport ?? new GaslessHttps();
  return (chainId, environmentName) => {
    const rpcUrl = environment[mmObservationRpcEnv(environmentName)];
    if (rpcUrl === undefined || rpcUrl.length === 0) mmFail("mm_gasless_rpc_binding");
    return new MetaMaskGaslessRpc({ chainId: mmChain(chainId), rpcUrl, clock, transport: selectedTransport, observationOnly: true });
  };
}

export function mmObservationRpcEnv(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !/^APN_[A-Z0-9_]+_RPC_URL$/u.test(value)) mmFail("mm_gasless_input");
  return value as string;
}

export class MetaMaskGaslessRpc implements MetaMaskGaslessRpcPort {
  readonly chainId: MetaMaskGaslessChainId;
  readonly endpointOrigin: string;
  readonly endpointHash: string;
  readonly rpcUrl: string;
  private readonly deployment;
  private readonly clock: ClockPort;
  private readonly transport: GaslessTransport;
  private sequence = 0n;
  private readonly callRpc: MmRpcCall;
  private readonly observationOnly: boolean;

  constructor(options: MetaMaskGaslessRpcOptions) {
    this.chainId = mmChain(options.chainId);
    this.deployment = mmRegistry(this.chainId);
    const endpoint = rpcEndpoint(options.rpcUrl);
    this.rpcUrl = endpoint.toString(); this.endpointOrigin = endpoint.origin;
    this.endpointHash = sha256(this.rpcUrl); this.clock = options.clock;
    this.transport = options.transport ?? new GaslessHttps();
    this.observationOnly = options.observationOnly === true;
    this.callRpc = async (method, params) => await this.call(method, params);
  }

  async balance(ownerInput: Address): Promise<MetaMaskGaslessBalance> {
    if (this.observationOnly) mmFail("mm_gasless_rpc_binding");
    const owner = strictOwner(ownerInput);
    await this.assertChain();
    const at = await rpcBlock(this.callRpc, this.deployment.row.finalityTag);
    const state = await readMetaMaskChainState(this.callRpc, this.deployment.row, owner, at.block, null);
    // Every read was pinned to this block by hash with requireCanonical, so its header is not rechecked.
    if ("counterAtomic" in state) mmFail("mm_gasless_internal");
    return { chainId: this.chainId, endpointHash: this.endpointHash, endpointOrigin: this.endpointOrigin,
      observedAt: this.clock.now().toISOString(), block: at.block, state };
  }

  async snapshot(input: { readonly owner: Address; readonly delegationHash: Hex;
    readonly grossAtomic: string; readonly feeMode?: "sponsored" }): Promise<MetaMaskGaslessSnapshot> {
    if (this.observationOnly) mmFail("mm_gasless_rpc_binding");
    const owner = strictOwner(input.owner), delegationHash = mmHex(input.delegationHash, 32, "mm_gasless_evidence_invalid");
    const grossAtomic = mmUint(input.grossAtomic, true, "mm_gasless_evidence_invalid").toString();
    await this.assertChain();
    const safe = await mmEvidenceAt("safe", async () => await rpcBlock(this.callRpc, this.deployment.row.finalityTag));
    const head = await mmEvidenceAt("latest", async () => await rpcBlock(this.callRpc, "latest"));
    const sameBlock = safe.block.numberAtomic === head.block.numberAtomic &&
      safe.block.hash === head.block.hash && safe.block.timestampAtomic === head.block.timestampAtomic;
    const [safeState, headState] = sameBlock
      ? await mmEvidenceAt("safe", async () => await readMetaMaskChainState(this.callRpc, this.deployment.row, owner, safe.block, delegationHash, input.feeMode))
        .then(state => [state, state] as const)
      : await Promise.all([
        mmEvidenceAt("safe", async () => await readMetaMaskChainState(this.callRpc, this.deployment.row, owner, safe.block, delegationHash, input.feeMode)),
        mmEvidenceAt("latest", async () => await readMetaMaskChainState(this.callRpc, this.deployment.row, owner, head.block, delegationHash, input.feeMode)),
      ]);
    // Both states were read pinned to their block hash with requireCanonical, so no header is rechecked.
    if (!("counterAtomic" in safeState) || !("counterAtomic" in headState)) mmFail("mm_gasless_internal");
    const snapshot = { chainId: this.chainId, endpointHash: this.endpointHash,
      endpointOrigin: this.endpointOrigin, observedAt: this.clock.now().toISOString(),
      safeBlock: safe.block, headBlock: head.block, safeState, headState };
    return validateMetaMaskGaslessSnapshot(snapshot, { chainId: this.chainId, endpointHash: this.endpointHash,
      endpointOrigin: this.endpointOrigin, grossAtomic, ...(input.feeMode === "sponsored" ? { feeMode: input.feeMode } : {}) });
  }

  async observe(intent: MetaMaskGaslessIntent, cursor: MetaMaskGaslessCursor,
    provider: MetaMaskGaslessProviderObservation | null): Promise<MetaMaskGaslessRpcObservation> {
    this.assertIntent(intent);
    await this.assertChain();
    // Another provider must first prove the same chain history at the operation's frozen safe anchor.
    // Any endpoint of the chain may observe once it proves the same history at the operation's frozen safe anchor.
    await recheckBlock(this.callRpc, intent.initialSnapshot.safeBlock, "mm_gasless_rpc_binding");
    return await observeMetaMaskGasless({ deployment: mmObservedDeployment(intent, this.deployment), call: this.callRpc,
      clock: this.clock }, intent, cursor, provider);
  }

  /**
   * Observation proves a saved operation against the deployment it froze (token, manager and enforcers from the
   * record, code pins from its prepare snapshot), never against today's registry: a later pin change refuses new
   * prepares only, and an operation sent before it still closes.
   */
  private assertIntent(intent: MetaMaskGaslessIntent): void {
    if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId) mmFail("mm_gasless_rpc_binding");
    const recorded = mmRecordedDeployment(intent);
    mmQuote(intent.quote, intent.request, intent.binding, intent.quote.netAtomic, "mm_gasless_state_corrupt", recorded);
    mmAssertStableQuote(intent.request, intent.quote, "mm_gasless_state_corrupt");
    mmValidateUnsigned({ unsignedDelegation: intent.unsignedDelegation, delegationHash: intent.delegationHash,
      signingDigest: intent.signingDigest, relayTo: intent.relayTo, mode: intent.mode },
    { owner: intent.binding.address, chainId: intent.request.chainId, executions: intent.quote.executions,
      deployment: recorded, ...(intent.quote.feeMode === "sponsored" ? { feeMode: intent.quote.feeMode } : {}) },
    "mm_gasless_state_corrupt");
  }

  private async assertChain(): Promise<void> {
    if (rpcQuantity(await this.callRpc("eth_chainId", [])) !== BigInt(this.chainId)) mmFail("mm_gasless_rpc_binding");
  }

  private async call(method: MmRpcMethod, params: readonly unknown[]): Promise<unknown> {
    if (!READ_METHODS.has(method)) mmEvidenceFail("mm_gasless_evidence_invalid", "rpc_method", method);
    const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    let response: { readonly status: number; readonly body: string };
    try { response = await this.transport.request(this.rpcUrl, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG"); }
    catch { return mmFail("mm_gasless_rpc_unavailable"); }
    if (response.status !== 200 || Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE) {
      // HTTP 429 on any read is the RPC asking APN to slow down; the pre-dispatch guard does not re-ask inside its window.
      mmFail(response.status === 429 ? "mm_gasless_rpc_rate_limited" : "mm_gasless_rpc_unavailable");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(response.body) as unknown; }
    catch { return mmEvidenceFail("mm_gasless_evidence_invalid", "rpc_json", method); }
    const record = rpcRecord(parsed), hasResult = Object.hasOwn(record, "result"), hasError = Object.hasOwn(record, "error");
    const keys = hasResult ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
    if (record.jsonrpc !== "2.0" || record.id !== id || hasResult === hasError || !exactKeys(record, keys)) {
      mmEvidenceFail("mm_gasless_evidence_invalid", "rpc_envelope", method);
    }
    if (hasError) mmFail(method === "eth_getLogs" ? mmLogQueryRefusal(record.error) : "mm_gasless_rpc_unavailable");
    return record.result;
  }
}

/**
 * Sort an eth_getLogs error into a closed class from its JSON-RPC message, which is read and then discarded: a range
 * or result-size limit is deterministic and worth a narrower window; a request limit is a rate limit; anything
 * else stays plain unavailability.
 */
export function mmLogQueryRefusal(error: unknown): MetaMaskGaslessFailureReason {
  const message = typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
    ? ((error as { message: string }).message).slice(0, 512) : "";
  if (/\b(?:rate[ -]limit(?:ed|ing)?|request limit|too many requests)\b/iu.test(message)) return "mm_gasless_rpc_rate_limited";
  return classifyX402LogAvailabilityMessage(message) === "range_unavailable" ? "mm_gasless_rpc_log_range" : "mm_gasless_rpc_unavailable";
}

function strictOwner(value: Address): Address {
  const owner = mmAddress(value, "mm_gasless_evidence_invalid");
  if (owner !== value) mmFail("mm_gasless_evidence_invalid");
  return owner;
}

function rpcEndpoint(value: string): URL {
  try { return parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "MetaMask gasless RPC endpoint", 2048); }
  catch { return mmFail("mm_gasless_rpc_binding"); }
}
