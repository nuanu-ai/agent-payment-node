import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { canonicalJson } from "../canonical.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { ApnError } from "../errors.js";
import { BridgeHttps } from "../lifi/https.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { CIRCLE_MINTER, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, CIRCLE_SOURCE_TOKEN,
  circleRoute, type CircleDestinationChain } from "./catalog.js";
import { circleHex, circleRecord, circleUint, type CircleAttesterSnapshot, type CircleObservation } from "./protocol.js";
import { circleTokenPairKey, verifyCircleDeployments, type CircleDeploymentSnapshot, type CircleAccountPreflight } from "./preflight.js";
import { circleBlocked, circleEnvelope, type CircleEnvelope } from "./operation-model.js";
import { circleEnvelopeEra } from "./funding-never-lands.js";
export const CIRCLE_RPC_ABI = parseAbi([
  "function localDomain() view returns(uint32)", "function version() view returns(uint32)", "function paused() view returns(bool)",
  "function remoteTokenMessengers(uint32) view returns(bytes32)", "function localMinter() view returns(address)",
  "function localMessageTransmitter() view returns(address)", "function messageBodyVersion() view returns(uint32)",
  "function localTokenMessenger() view returns(address)", "function remoteTokensToLocalTokens(bytes32) view returns(address)",
  "function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)", "function usedNonces(bytes32) view returns(uint256)",
  "function signatureThreshold() view returns(uint256)", "function getNumEnabledAttesters() view returns(uint256)", "function getEnabledAttester(uint256) view returns(address)",
]);
const METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_getCode", "eth_getStorageAt", "eth_call",
  "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getLogs",
  "eth_getBlockTransactionCountByNumber", "eth_getTransactionByBlockNumberAndIndex"]);
const READ_METHODS = new Set([...METHODS].filter(method => method !== "eth_sendRawTransaction"));
/** Read plans of the live rails in calls per client (P4): chain identity; functional configuration with its head;
 * the attester set (head, threshold, count, at most 20 attesters); one account; one envelope (head, tip, estimate);
 * one effect preflight (two nonces, balance, allowance, estimate, simulation, mint head and used nonce); one
 * observation (transaction, receipt, finality head, canonical block); one ambiguous-send check on the shared never-lands
 * rule (chain id, finalized nonce, receipt, transaction; the era block's count and first transaction; the deciding nonce,
 * receipt, transaction and probe). */
export const CIRCLE_READ_PLAN = { identity: 1, configuration: 13, attesters: 23, account: 5, envelope: 3, preflight: 8, observation: 4, single: 1, ambiguous: 10 } as const;
/** The longest live command: identity, configuration, attesters, two accounts, two envelopes, three effect preflights,
 * eight observations, one ambiguous-send check (above) and four single reads (allowance,
 * used nonce, cleanup nonce, mint head), each retried once. */
export const CIRCLE_COMMAND_REQUEST_BUDGET = 2 * (CIRCLE_READ_PLAN.identity + CIRCLE_READ_PLAN.configuration + CIRCLE_READ_PLAN.attesters +
  2 * CIRCLE_READ_PLAN.account + 2 * CIRCLE_READ_PLAN.envelope + 3 * CIRCLE_READ_PLAN.preflight + 8 * CIRCLE_READ_PLAN.observation + CIRCLE_READ_PLAN.ambiguous + 4 * CIRCLE_READ_PLAN.single);
const transient = (e: unknown) => e instanceof ApnError && typeof e.details?.status === "number" && [429, 500, 502, 503, 504].includes(e.details.status);
interface CircleQueuedRead { readonly method: string; readonly params: readonly unknown[]; readonly gate: () => void; readonly resolve: (value: unknown) => void; readonly reject: (error: unknown) => void; }
/** Public HTTPS/DNS pinning and physical request accounting. Only transient read-only HTTP failures
 * retry once; an observation restarts wholly. Financial RPC is never retried. The chain id is checked once per client,
 * reads issued together leave as one JSON-RPC batch POST (every default Circle endpoint accepts batches), and an
 * observation needs no header sandwich. */
export class CircleRpc {
  private sequence = 0; private requests = 0; private posts = 0; private readonly endpoint: string;
  private chainVerified = false; private queued: CircleQueuedRead[] = [];
  private readonly scopes = new AsyncLocalStorage<{ readonly retryRead: boolean }>();
  constructor(url: string, readonly chainId: number, private readonly https: Pick<BridgeHttps, "request"> = new BridgeHttps(), private readonly maxRequests = 256) {
    const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "Circle RPC", 2048);
    if (parsed.search !== "" || parsed.hash !== "") circleBlocked("rpc_url"); this.endpoint = parsed.toString();
  }
  /** Read calls counted against the budget, and physical POSTs sent (a batch is one POST). */
  get requestCount(): number { return this.requests; }
  get postCount(): number { return this.posts; }
  async call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown> {
    const gate = () => { beforeSend?.(); }, retry = READ_METHODS.has(method) && this.scopes.getStore()?.retryRead !== false;
    for (let attempt = 0; ; attempt++) {
      try { return await this.physicalCall(method, params, gate, beforeSend !== undefined); }
      catch (error) { if (!retry || attempt >= 1 || !transient(error)) throw error; gate(); await new Promise(resolve => setTimeout(resolve, 100)); gate(); }
    }
  }
  private async physicalCall(method: string, params: readonly unknown[], gate: () => void, financialConsent: boolean): Promise<unknown> {
    // The read budget bounds read volume; the one fenced financial send per effect is outside it, so an exhausted
    // read budget can never turn a signed effect past its submission fence into an ambiguous unknown (R3).
    gate(); if (!METHODS.has(method) || method !== "eth_sendRawTransaction" && ++this.requests > this.maxRequests) circleBlocked("rpc_method_or_budget");
    if (method === "eth_sendRawTransaction" && !financialConsent) circleBlocked("financial_rpc_consent_required");
    if (method !== "eth_sendRawTransaction") return new Promise((resolve, reject) => {
      this.queued.push({ method, params, gate, resolve, reject }); if (this.queued.length === 1) queueMicrotask(() => { void this.flush(); });
    });
    const id = ++this.sequence, value = await this.post(canonicalJson({ jsonrpc: "2.0", id, method, params }), method, gate);
    return this.result(this.envelopeRecord(value, method), id, method, gate);
  }
  /** Reads queued in the same tick leave as one POST; a lone read keeps the plain single-call wire shape. */
  private async flush(): Promise<void> {
    const entries = this.queued.splice(0).filter(entry => { try { entry.gate(); return true; } catch (error) { entry.reject(error); return false; } });
    if (entries.length === 0) return;
    const gate = () => { for (const entry of entries) entry.gate(); }, ids = entries.map(() => ++this.sequence);
    try {
      if (entries.length === 1) { const entry = entries[0]!; entry.resolve(this.result(this.envelopeRecord(await this.post(canonicalJson({ jsonrpc: "2.0", id: ids[0], method: entry.method, params: entry.params }), entry.method, gate), entry.method), ids[0]!, entry.method, gate)); return; }
      const value = await this.post(canonicalJson(entries.map((entry, i) => ({ jsonrpc: "2.0", id: ids[i], method: entry.method, params: entry.params }))), "eth_call", gate);
      if (!Array.isArray(value) || value.length !== entries.length) throw new ApnError("APN_RPC_PROTOCOL", "Circle RPC batch result is invalid.", { method: "batch", origin: new URL(this.endpoint).origin, stage: "protocol" });
      const rows = new Map<unknown, Record<string, unknown>>(); for (const raw of value) { const row = this.envelopeRecord(raw, "batch"); if (rows.has(row.id)) throw new ApnError("APN_RPC_PROTOCOL", "Circle RPC batch result is invalid.", { method: "batch", stage: "protocol" }); rows.set(row.id, row); }
      entries.forEach((entry, i) => { try { entry.resolve(this.result(rows.get(ids[i]) ?? {}, ids[i]!, entry.method, gate)); } catch (error) { entry.reject(error); } });
    } catch (error) { for (const entry of entries) entry.reject(error); }
  }
  private async post(body: string, method: string, gate: () => void): Promise<unknown> {
    const origin = new URL(this.endpoint).origin;
    let response: Awaited<ReturnType<BridgeHttps["request"]>>;
    this.posts++;
    try { response = await this.https.request(this.endpoint, "POST", body, 1024 * 1024, "APN_RPC_CONFIG", gate); }
    catch (error) { if (error instanceof ApnError) throw new ApnError(error.code, "Circle RPC transport failed.", { method, origin, stage: "transport" }); throw error; }
    gate();
    if (response.status !== 200) throw new ApnError("APN_RPC_CONFIG", "Circle RPC returned an unsuccessful HTTP response.", { method, origin, status: response.status, stage: "response" });
    try { return JSON.parse(response.body) as unknown; } catch { throw new ApnError("APN_RPC_PROTOCOL", "Circle RPC result cannot be decoded.", { method, origin, stage: "protocol" }); }
  }
  private envelopeRecord(value: unknown, method: string): Record<string, unknown> {
    try { return circleRecord(value); } catch (error) { throw new ApnError(error instanceof ApnError ? error.code : "APN_RPC_PROTOCOL", "Circle RPC result cannot be decoded.", { method, origin: new URL(this.endpoint).origin, stage: "protocol" }); }
  }
  private result(value: Record<string, unknown>, id: number, method: string, gate: () => void): unknown {
    if (value.jsonrpc !== "2.0" || value.id !== id || !Object.hasOwn(value, "result") || Object.hasOwn(value, "error")) throw new ApnError("APN_RPC_PROTOCOL", "Circle RPC result envelope is invalid.", { method, origin: new URL(this.endpoint).origin, stage: "protocol" });
    gate(); return value.result;
  }
  async identity() {
    if (this.chainVerified) return;
    if (circleUint(await this.call("eth_chainId", [])) !== BigInt(this.chainId)) circleBlocked("rpc_chain_changed");
    this.chainVerified = true;
  }
  async read(to: Address, name: string, args: readonly unknown[] = [], tag: string | { readonly blockHash: Hex; readonly requireCanonical: true } = "latest"): Promise<unknown> {
    const data = encodeFunctionData({ abi: CIRCLE_RPC_ABI, functionName: name as never, args: args as never });
    const result = circleHex(await this.call("eth_call", [{ to, data }, tag]));
    return decodeFunctionResult({ abi: CIRCLE_RPC_ABI, functionName: name as never, data: result });
  }
  async block(tag: string) { return circleRecord(await this.call("eth_getBlockByNumber", [tag, false])); }
  async observation(transactionHash: Hex, finalityTag: "included" | "safe" | "finalized"): Promise<CircleObservation | null> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.scopes.run({ retryRead: false }, () => this.leanObservation(transactionHash, finalityTag)); }
      catch (error) { if (attempt >= 1 || !transient(error)) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
  }
  /** Two POSTs: transaction and receipt, then the finality head with the canonical block at the receipt height. A head
   * at or above that height read with the canonical block makes a separate header recheck redundant (P2). */
  private async leanObservation(transactionHash: Hex, finalityTag: "included" | "safe" | "finalized"): Promise<CircleObservation | null> {
    await this.identity(); const [transaction, receipt] = await Promise.all([this.call("eth_getTransactionByHash", [transactionHash]), this.call("eth_getTransactionReceipt", [transactionHash])]);
    if (transaction === null || receipt === null) return null;
    const r = circleRecord(receipt); if (r.blockNumber === null || r.blockHash === null) return null;
    const [finalityHead, canonicalBlock] = await Promise.all([this.block(finalityTag === "included" ? "latest" : finalityTag), this.block(String(r.blockNumber))]);
    if (circleUint(finalityHead.number) < circleUint(r.blockNumber)) return null;
    return { transaction, receipt, canonicalBlock, recheckedBlock: canonicalBlock, finalityHead, chainId: this.chainId, finalityTag };
  }
  async account(address: Address, token: Address, spender: Address): Promise<CircleAccountPreflight> {
    await this.identity(); const values = await Promise.all([this.call("eth_getBalance", [address, "pending"]), this.read(token, "balanceOf", [address]), this.read(token, "allowance", [address, spender]),
      this.call("eth_getTransactionCount", [address, "latest"]), this.call("eth_getTransactionCount", [address, "pending"])]);
    return { chainId: this.chainId, address, nativeBalanceAtomic: circleUint(values[0]).toString(), usdcBalanceAtomic: String(values[1]), allowanceAtomic: String(values[2]), latestNonceAtomic: circleUint(values[3]).toString(), pendingNonceAtomic: circleUint(values[4]).toString() };
  }
  async envelope(from: Address, to: Address, data: Hex, nonceAtomic: string, gasLimit?: string): Promise<CircleEnvelope> {
    await this.identity(); const [block, rawTip, rawEstimate] = await Promise.all([this.block("latest"), this.chainId === 42161 ? Promise.resolve("0x0") : this.call("eth_maxPriorityFeePerGas", []),
      gasLimit === undefined ? this.call("eth_estimateGas", [{ from, to, data, value: "0x0" }, "latest"]) : Promise.resolve(null)]);
    const tip = circleUint(rawTip), gas = gasLimit === undefined ? circleUint(rawEstimate) * 12n / 10n + 1n : BigInt(gasLimit);
    return circleEnvelope({ chainId: this.chainId, from, to, data, valueAtomic: "0", nonceAtomic, gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: (circleUint(block.baseFeePerGas) * 2n + tip).toString(), maxPriorityFeePerGasAtomic: tip.toString(),
      eraBlock: circleEnvelopeEra(block) });
  }
  /** One JSON-RPC batch (one POST, so one node answers every read in it) for the never-lands proof; never retried read by read. */
  async finalizedBatch(calls: readonly { readonly method: string; readonly params: readonly unknown[] }[]): Promise<readonly unknown[]> {
    return await this.scopes.run({ retryRead: false }, async () => await Promise.all(calls.map(call => this.call(call.method, call.params))));
  }
}
function hexQuantity(input: unknown): string { return `0x${circleUint(input).toString(16)}`; }
/** The live rails read functional configuration only, at the latest head, as one batch: domains, remote messenger,
 * local minter/transmitter, token pair, versions, decimals and paused flags (P1/P5). Implementation addresses and
 * code hashes change on legitimate Circle upgrades and are not read. */
export async function readCircleDeployment(rpc: CircleRpc, destinationChain: CircleDestinationChain): Promise<CircleDeploymentSnapshot> {
  await rpc.identity(); const route = circleRoute(destinationChain), source = rpc.chainId === 42161, token = source ? CIRCLE_SOURCE_TOKEN : route.token, remoteDomain = source ? route.domain : 3,
    remoteToken = source ? route.token : CIRCLE_SOURCE_TOKEN, tag = "latest";
  const [block, values] = await Promise.all([rpc.block("latest"), Promise.all([rpc.read(CIRCLE_TRANSMITTER, "localDomain", [], tag), rpc.read(CIRCLE_MESSENGER, "remoteTokenMessengers", [remoteDomain], tag),
    rpc.read(CIRCLE_MINTER, "remoteTokensToLocalTokens", [circleTokenPairKey(remoteDomain, remoteToken)], tag), rpc.read(CIRCLE_MESSENGER, "localMinter", [], tag),
    rpc.read(CIRCLE_MESSENGER, "localMessageTransmitter", [], tag), rpc.read(CIRCLE_MINTER, "localTokenMessenger", [], tag), rpc.read(CIRCLE_TRANSMITTER, "version", [], tag),
    rpc.read(CIRCLE_MESSENGER, "messageBodyVersion", [], tag), rpc.read(token, "decimals", [], tag), rpc.read(CIRCLE_TRANSMITTER, "paused", [], tag), rpc.read(CIRCLE_MINTER, "paused", [], tag), rpc.read(token, "paused", [], tag)])]);
  return { chainId: rpc.chainId as 42161 | CircleDestinationChain, domain: Number(values[0]), blockHash: circleHex(block.hash, 32), blockNumberAtomic: circleUint(block.number).toString(),
    remoteDomain, remoteMessenger: circleHex(values[1], 32), pairedToken: getAddress(String(values[2])), localMinter: getAddress(String(values[3])), localMessageTransmitter: getAddress(String(values[4])),
    localTokenMessenger: getAddress(String(values[5])), messageVersion: Number(values[6]), messageBodyVersion: Number(values[7]), tokenDecimals: Number(values[8]), transmitterPaused: values[9] === true, minterPaused: values[10] === true, tokenPaused: values[11] === true };
}
export async function currentCircleDeployments(source: CircleRpc, destination: CircleRpc, chain: CircleDestinationChain) {
  const [a, b] = await Promise.all([readCircleDeployment(source, chain), readCircleDeployment(destination, chain)]);
  return { source: a, destination: b, digest: verifyCircleDeployments(a, b) };
}
/** The live rails read the attester set at the latest head: threshold and count in one batch, then every enabled
 * attester in a second. Signatures are recovered against this set; no block sandwich is needed for a current read. */
export async function readCircleAttesters(rpc: CircleRpc, deploymentDigest: string): Promise<CircleAttesterSnapshot> {
  await rpc.identity(); const tag = "latest";
  const [block, rawThreshold, rawCount] = await Promise.all([rpc.block("latest"), rpc.read(CIRCLE_TRANSMITTER, "signatureThreshold", [], tag), rpc.read(CIRCLE_TRANSMITTER, "getNumEnabledAttesters", [], tag)]);
  const threshold = Number(rawThreshold), count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 1 || count > 20 || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > count) circleBlocked("attester_count");
  const enabledAttesters: Address[] = (await Promise.all(Array.from({ length: count }, (_, i) => rpc.read(CIRCLE_TRANSMITTER, "getEnabledAttester", [BigInt(i)], tag)))).map(value => getAddress(String(value)));
  return { threshold, enabledAttesters, chainId: rpc.chainId as CircleDestinationChain, transmitter: CIRCLE_TRANSMITTER, blockHash: circleHex(block.hash, 32), blockNumberAtomic: circleUint(block.number).toString(), deploymentDigest };
}
export const circleRpcTransaction = (e: CircleEnvelope) => ({ from: e.from, to: e.to, data: e.data, value: "0x0", nonce: hexQuantity(e.nonceAtomic), gas: hexQuantity(e.gasLimitAtomic), maxFeePerGas: hexQuantity(e.maxFeePerGasAtomic), maxPriorityFeePerGas: hexQuantity(e.maxPriorityFeePerGasAtomic) });
