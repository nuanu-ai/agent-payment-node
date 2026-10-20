import { rpcObservationCounters, rpcObservationSnapshot } from "./rpc-observation-metrics.js";
import { MAX_RPC_BATCH_CALLS, BATCH_READ_METHODS, readOnlyBatchMethod, parseRpcResultEnvelope, parseRpcBatchResultEnvelope, parseRpcLogEnvelope, postJson, rpcAbortableWait } from "./rpc-envelope.js";
export { parseRpcResultEnvelope, parseRpcBatchResultEnvelope, parseRpcLogEnvelope, classifyX402LogAvailabilityMessage, acceptRpcHttpBody } from "./rpc-envelope.js";
export { isPublicIp } from "./network-policy.js";
import { performance } from "node:perf_hooks";
import { record, rpcAddress, rpcQuantity, rpcHex, rpcUint256Data, nonzeroBytes32, x402RpcLog } from "./base-rpc-codec.js";
import { releasedX402Pair, x402Asset, type X402Asset } from "./x402-network.js";
import { readX402Permit2NonceBit, readX402Permit2PrepareEvidence, type X402Permit2PrepareEvidence } from "./x402-permit2-rpc.js";
import { sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_ID, MAX_RPC_RESPONSE_BYTES, TRANSFER_TOPIC } from "./constants.js";
import { ApnError } from "./errors.js";
import { readEvmReceiptFeeFields } from "./evm-direct-actual-fee.js";
import { EvmRpc } from "./evm-rpc.js";
import { EvmDirectRpcGuard } from "./evm-direct-rpc-guard.js";
import type { StateStore } from "./state.js";
import { parseAtomic } from "./money.js";
import type { Address, Hex } from "./model.js";
import { parsePublicHttpsUrl, resolvePublicAddresses, type PinnedAddress } from "./network-policy.js";
import type {
  BalanceSnapshot, FeeEstimate, RpcLog, RpcPort, RpcReceipt, X402AuthorizationState, X402AuthorizationUsedLogs,
  X402BlockReference, X402PrepareEvidence, X402RpcBlock, X402RpcHead, X402RpcLog, X402RpcPort, X402RpcReceipt, X402TransferLogs,
} from "./ports.js";

const AUTHORIZATION_STATE_SELECTOR = "0xe94a0102";
const AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const MAX_X402_LOGS = 256;
export type ReadOnlyRpcBatchCall = { readonly method: string; readonly params: readonly unknown[] };

export class HttpsBaseRpc implements RpcPort, X402RpcPort {
  readonly evm: EvmRpc;
  readonly endpoint: URL;
  readonly rpcOrigin: string;
  private sequence = 0n;
  private readonly observationCounters = rpcObservationCounters();
  get observationMetrics() { return rpcObservationSnapshot(this.observationCounters); }
  /** The x402 network and token every x402 read of this instance binds; none unless the caller selected one. */
  private readonly x402: X402Asset | undefined;
  private pinnedAddresses: Promise<readonly PinnedAddress[]> | undefined;
  /** One eth_chainId per command invocation and endpoint, shared by every bounded or network-selected copy. */
  private chainIdCell: { value?: Promise<bigint> } = {};
  private readonly totalDeadlineMs: number | undefined;
  private readonly abortSignal: AbortSignal | undefined;
  private directGuard: EvmDirectRpcGuard | undefined;
  private readonly directGuardState: StateStore | undefined;

  constructor(endpoint: string, options: { readonly totalDeadlineMs?: number; readonly x402Asset?: X402Asset;
    readonly abortSignal?: AbortSignal; readonly directGuardState?: StateStore } = {}) {
    const parsed = parsePublicHttpsUrl(endpoint, "APN_RPC_CONFIG", "RPC endpoint");
    this.endpoint = parsed;
    this.rpcOrigin = parsed.origin;
    this.evm = new EvmRpc((method, params) => this.call(method, params), this.rpcOrigin, undefined,
      (calls) => this.batchCall(calls));
    this.totalDeadlineMs = options.totalDeadlineMs;
    this.abortSignal = options.abortSignal;
    this.directGuardState = options.directGuardState;
    this.x402 = options.x402Asset;
  }

  /** The selected x402 asset; an instance built without one (direct transfers, relays, Permit2 reads) answers no x402 read. */
  private bound(): X402Asset {
    if (this.x402 === undefined) throw new ApnError("APN_INTERNAL", "This RPC binds no x402 network and token; select one with forX402Network.");
    return this.x402;
  }

  /** The first arm of an invocation sets its cap; direct EVM steps pass the cap derived from their read plan. */
  armEvmDirectRpcGuard(maxPhysicalRequests = 24): void {
    if (this.directGuardState === undefined) throw new ApnError("APN_RPC_CONFIG", "Direct EVM RPC guard state is unavailable.");
    if (this.abortSignal === undefined) {
      this.directGuard ??= new EvmDirectRpcGuard(this.directGuardState, maxPhysicalRequests);
      return;
    }
    const signal = this.abortSignal;
    const wait = rpcAbortableWait(signal);
    this.directGuard ??= new EvmDirectRpcGuard(this.directGuardState, maxPhysicalRequests, Date.now, wait, () => this.remainingTimeoutMs());
  }

  /** Relay uses a single cancellation signal for all POSTs in one execute invocation. */
  withAbortSignal(signal: AbortSignal): HttpsBaseRpc {
    const selected = new HttpsBaseRpc(this.endpoint.toString(), { abortSignal: signal, ...(this.x402 === undefined ? {} : { x402Asset: this.x402 }) });
    selected.pinnedAddresses = this.pinnedAddresses; selected.chainIdCell = this.chainIdCell;
    return selected;
  }

  /** Resolve and validate public addresses before a caller reserves a physical POST start. */
  async primePublicAddresses(): Promise<void> {
    await (this.pinnedAddresses ??= this.resolvePublicAddresses());
  }

  withTotalTimeout(milliseconds: number): X402RpcPort {
    if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 20_000) {
      throw new ApnError("APN_RPC_CONFIG", "Bounded x402 RPC timeout is invalid.");
    }
    const bounded = new HttpsBaseRpc(this.endpoint.toString(), {
      totalDeadlineMs: performance.now() + milliseconds,
      ...(this.x402 === undefined ? {} : { x402Asset: this.x402 }),
    });
    bounded.pinnedAddresses = this.pinnedAddresses; bounded.chainIdCell = this.chainIdCell;
    return bounded;
  }

  forX402Network(chainId: number, token?: Address): HttpsBaseRpc {
    const asset = x402Asset(chainId, token);
    // An instance already bound to exactly this network and token is that binding.
    if (this.x402 !== undefined && this.x402.chainId === asset.chainId && this.x402.token === asset.token) return this;
    const selected = new HttpsBaseRpc(this.endpoint.toString(), {
      x402Asset: asset, ...(this.totalDeadlineMs === undefined ? {} : { totalDeadlineMs: this.totalDeadlineMs }),
    });
    selected.pinnedAddresses = this.pinnedAddresses; selected.chainIdCell = this.chainIdCell;
    return selected;
  }

  async assertX402Chain(chainId: number): Promise<{ readonly chainId: number; readonly rpcOrigin: string }> {
    if (chainId !== this.bound().chainId) throw new ApnError("APN_CHAIN_MISMATCH", "x402 RPC binding belongs to another network.");
    const served = await this.endpointChainId();
    if (served !== BigInt(chainId)) {
      throw new ApnError("APN_CHAIN_MISMATCH", `The --rpc-url endpoint serves chain ${served}, not the selected x402 network eip155:${chainId}.`,
        { reason: "x402_rpc_chain_mismatch", chain: `eip155:${chainId}` });
    }
    return { chainId, rpcOrigin: this.rpcOrigin };
  }

  /** Proven once per instance (its IP is pinned); later Base reads in the same invocation do not re-ask. */
  async assertBaseChain(): Promise<{ readonly chainId: 8453; readonly rpcOrigin: string }> {
    if (await this.endpointChainId() !== BigInt(CHAIN_ID)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC endpoint is not Base chain ID 8453.");
    return { chainId: CHAIN_ID, rpcOrigin: this.rpcOrigin };
  }

  private async endpointChainId(): Promise<bigint> {
    const cell = this.chainIdCell;
    const pending = cell.value ??= this.call("eth_chainId", []).then(rpcQuantity);
    try { return await pending; } catch (error) { if (cell.value === pending) delete cell.value; throw error; }
  }

  async getBalances(address: Address): Promise<BalanceSnapshot> {
    await this.assertBaseChain();
    const block = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
    const blockNumber = rpcQuantity(block.number).toString();
    const blockHash = rpcHex(block.hash, 32);
    const tag = block.number;
    const eth = rpcQuantity(await this.call("eth_getBalance", [address, tag])).toString();
    const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
    const usdc = rpcUint256Data(await this.call("eth_call", [{ to: BASE_USDC, data }, tag]), "USDC balance");
    return { address, ethAtomic: eth, usdcAtomic: usdc, blockNumberAtomic: blockNumber, blockHash, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin };
  }

  /**
   * One header at the asset's proof tag, then one batch pinned to it (EIP-1898, no header recheck): balance and
   * DOMAIN_SEPARATOR; for a token outside the released USDC pairs also decimals() and authorizationState(payer, nonce)
   * of the fresh nonce, which proves the EIP-3009 state the settlement proof reads exists and answers.
   */
  async getX402PrepareEvidence(address: Address, nonce?: Hex): Promise<X402PrepareEvidence> {
    const tag = this.bound().proofTag;
    const block = record(await this.call("eth_getBlockByNumber", [tag, false]), `${tag} block`);
    const number = rpcQuantity(block.number).toString();
    const hash = nonzeroBytes32(block.hash, `${tag} block hash`);
    const timestamp = rpcQuantity(block.timestamp).toString();
    const pinned = { blockHash: hash, requireCanonical: true }, token = this.bound().token;
    const released = releasedX402Pair(this.bound().chainId, token);
    if (!released && (nonce === undefined || !/^0x[0-9a-f]{64}$/u.test(nonce))) throw new ApnError("APN_INTERNAL", "x402 token probe nonce is missing.");
    const owner = address.slice(2).toLowerCase().padStart(64, "0");
    const reads = this.batchCall([
      { method: "eth_call", params: [{ to: token, data: `0x70a08231${owner}` }, pinned] },
      { method: "eth_call", params: [{ to: token, data: "0x3644e515" }, pinned] },
      ...(released ? [] : [
        { method: "eth_call", params: [{ to: token, data: "0x313ce567" }, pinned] },
        { method: "eth_call", params: [{ to: token, data: `${AUTHORIZATION_STATE_SELECTOR}${owner}${nonce!.slice(2)}` }, pinned] },
      ]),
    ]);
    const values = released ? await reads : await reads.catch((error: unknown) => {
      if (!(error instanceof ApnError) || error.code !== "APN_RPC_PROTOCOL") throw error;
      throw new ApnError("APN_X402_UNSUPPORTED_OFFER", `The token ${token} on eip155:${this.bound().chainId} did not answer balanceOf, DOMAIN_SEPARATOR, ` +
        "decimals and EIP-3009 authorizationState at one block: it is not an EIP-3009 token, or this RPC refused the reads.",
      { reason: "x402_token_reads_failed", chain: this.bound().network, asset: token });
    });
    return {
      address,
      usdcAtomic: rpcUint256Data(values[0], "token balance"),
      domainSeparator: rpcHex(values[1], 32),
      rpcOriginHash: sha256(this.rpcOrigin),
      observedAt: new Date().toISOString(),
      queriedTag: tag,
      block: { number, hash, timestamp },
      ...(released ? {} : { tokenFacts: tokenFacts(values[2], values[3]) }),
    };
  }

  async getX402Head(tag: "safe" | "finalized"): Promise<X402RpcHead> {
    const block = record(await this.call("eth_getBlockByNumber", [tag, false]), `${tag} block`);
    const observedAt = new Date().toISOString();
    const timestamp = rpcQuantity(block.timestamp).toString();
    if (BigInt(timestamp) > BigInt(Math.floor(Date.parse(observedAt) / 1000))) {
      throw new ApnError("APN_RPC_PROTOCOL", `RPC ${tag} block is future-dated.`);
    }
    return {
      queriedTag: tag,
      number: rpcQuantity(block.number).toString(),
      hash: nonzeroBytes32(block.hash, `${tag} block hash`),
      timestamp,
      observedAt,
      rpcOrigin: this.rpcOrigin,
    };
  }

  async getX402Block(number: string): Promise<X402RpcBlock> {
    const quantity = parseAtomic(number);
    const block = record(await this.call("eth_getBlockByNumber", [`0x${quantity.toString(16)}`, false]), "numbered block");
    if (rpcQuantity(block.number) !== quantity) throw new ApnError("APN_RPC_PROTOCOL", "RPC numbered block identity is inconsistent.");
    const observedAt = new Date().toISOString();
    const timestamp = rpcQuantity(block.timestamp).toString();
    if (BigInt(timestamp) > BigInt(Math.floor(Date.parse(observedAt) / 1000))) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC numbered block is future-dated.");
    }
    return {
      queriedTag: "number",
      number,
      hash: nonzeroBytes32(block.hash, "numbered block hash"),
      timestamp,
      observedAt,
      rpcOrigin: this.rpcOrigin,
    };
  }

  async getX402Receipt(transactionHash: Hex): Promise<X402RpcReceipt | null> {
    const raw = await this.call("eth_getTransactionReceipt", [transactionHash]);
    if (raw === null) return null;
    const receipt = record(raw, "x402 transaction receipt");
    const status = rpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt status is invalid.");
    const receiptTransactionHash = nonzeroBytes32(receipt.transactionHash, "receipt transaction hash");
    const blockNumber = rpcQuantity(receipt.blockNumber).toString();
    const blockHash = nonzeroBytes32(receipt.blockHash, "receipt block hash");
    if (!Array.isArray(receipt.logs) || receipt.logs.length > MAX_X402_LOGS) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt logs exceed the fixed bound.");
    }
    const logs = receipt.logs.map((entry: unknown) => x402RpcLog(entry));
    if (logs.some((log) =>
      log.transactionHash !== receiptTransactionHash || log.blockNumber !== blockNumber || log.blockHash !== blockHash
    )) throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt log identity is inconsistent.");
    return {
      transactionHash: receiptTransactionHash,
      status: status === 1n ? "success" : "reverted",
      blockNumber,
      blockHash,
      logs,
      observedAt: new Date().toISOString(),
      rpcOrigin: this.rpcOrigin,
    };
  }

  async getX402AuthorizationState(
    authorizer: Address,
    nonce: Hex,
    block: X402BlockReference,
  ): Promise<X402AuthorizationState> {
    const identity = "tag" in block ? await this.getX402Head(block.tag) : await this.getX402Block(block.number);
    const tag = `0x${BigInt(identity.number).toString(16)}`;
    const data = `${AUTHORIZATION_STATE_SELECTOR}${authorizer.slice(2).toLowerCase().padStart(64, "0")}${rpcHex(nonce, 32).slice(2)}`;
    const encoded = rpcHex(await this.call("eth_call", [{ to: this.bound().token, data }, tag]), 32);
    const value = BigInt(encoded);
    if (value !== 0n && value !== 1n) throw new ApnError("APN_RPC_PROTOCOL", "RPC authorization state is not a canonical boolean.");
    return {
      value: value === 1n,
      blockNumber: identity.number,
      blockHash: identity.hash,
      blockTimestamp: identity.timestamp,
      blockTag: "tag" in block ? block.tag : "number",
      observedAt: new Date().toISOString(),
      rpcOrigin: this.rpcOrigin,
    };
  }

  /** Prepare evidence of a Permit2 offer for this instance's asset (src/x402-permit2-rpc.ts). */
  async getX402Permit2PrepareEvidence(address: Address, nonce: Hex, permitNeeded: (allowanceAtomic: string) => boolean): Promise<X402Permit2PrepareEvidence> {
    return await readX402Permit2PrepareEvidence({ call: (method, params) => this.call(method, params), batch: (calls) => this.batchCall(calls),
      rpcOrigin: this.rpcOrigin, asset: this.bound(), address, nonce, permitNeeded });
  }

  /** Permit2's nonce bit, read like `getX402AuthorizationState` at a tag's or a number's block. */
  async getX402Permit2NonceState(owner: Address, nonce: Hex, block: X402BlockReference): Promise<X402AuthorizationState> {
    const identity = "tag" in block ? await this.getX402Head(block.tag) : await this.getX402Block(block.number);
    const value = await readX402Permit2NonceBit({ call: (method, params) => this.call(method, params), owner, nonce, blockNumber: identity.number });
    return { value, blockNumber: identity.number, blockHash: identity.hash, blockTimestamp: identity.timestamp,
      blockTag: "tag" in block ? block.tag : "number", observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin };
  }

  async getX402AuthorizationUsedLogs(input: {
    readonly authorizer: Address;
    readonly nonce: Hex;
    readonly fromBlock: string;
    readonly toBlock: string;
  }): Promise<X402AuthorizationUsedLogs> {
    const from = parseAtomic(input.fromBlock);
    const to = parseAtomic(input.toBlock);
    if (from > to || to - from + 1n > 2048n) throw new ApnError("APN_RPC_PROTOCOL", "RPC AuthorizationUsed range exceeds the fixed bound.");
    const result = await this.callX402Logs([{
      address: this.bound().token,
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
      topics: [
        AUTHORIZATION_USED_TOPIC,
        `0x${input.authorizer.slice(2).toLowerCase().padStart(64, "0")}`,
        rpcHex(input.nonce, 32),
      ],
    }]);
    if (result.kind !== "complete") return result;
    if (!Array.isArray(result.value) || result.value.length > MAX_X402_LOGS) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC AuthorizationUsed logs exceed the fixed bound.");
    }
    const logs = result.value.map((entry: unknown) => x402RpcLog(entry));
    for (const log of logs) {
      if (
        log.address.toLowerCase() !== this.bound().token.toLowerCase() || log.topics.length !== 3 ||
        log.topics[0] !== AUTHORIZATION_USED_TOPIC ||
        log.topics[1] !== `0x${input.authorizer.slice(2).toLowerCase().padStart(64, "0")}` ||
        log.topics[2] !== input.nonce.toLowerCase() || log.data !== "0x" ||
        BigInt(log.blockNumber) < from || BigInt(log.blockNumber) > to
      ) throw new ApnError("APN_RPC_PROTOCOL", "RPC AuthorizationUsed log violates the exact filter.");
    }
    return { kind: "complete", logs };
  }

  async getX402TransferLogs(input: {
    readonly from: Address;
    readonly to?: Address;
    readonly fromBlock: string;
    readonly toBlock: string;
  }): Promise<X402TransferLogs> {
    const from = parseAtomic(input.fromBlock);
    const to = parseAtomic(input.toBlock);
    if (from > to || to - from + 1n > 2048n) throw new ApnError("APN_RPC_PROTOCOL", "RPC Transfer range exceeds the fixed bound.");
    const fromTopic = `0x${input.from.slice(2).toLowerCase().padStart(64, "0")}`, toTopic = input.to === undefined ? undefined : `0x${input.to.slice(2).toLowerCase().padStart(64, "0")}`;
    const result = await this.callX402Logs([{
      address: this.bound().token,
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
      topics: toTopic === undefined ? [TRANSFER_TOPIC, fromTopic] : [TRANSFER_TOPIC, fromTopic, toTopic],
    }]);
    if (result.kind !== "complete") return result;
    if (!Array.isArray(result.value) || result.value.length > MAX_X402_LOGS) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC Transfer logs exceed the fixed bound.");
    }
    const logs = result.value.map((entry: unknown) => x402RpcLog(entry));
    for (const log of logs) {
      if (
        log.address.toLowerCase() !== this.bound().token.toLowerCase() || log.topics.length !== 3 ||
        log.topics[0] !== TRANSFER_TOPIC || log.topics[1] !== fromTopic || (toTopic !== undefined && log.topics[2] !== toTopic) || log.data.length !== 66 ||
        BigInt(log.blockNumber) < from || BigInt(log.blockNumber) > to
      ) throw new ApnError("APN_RPC_PROTOCOL", "RPC Transfer log violates the exact filter.");
    }
    return { kind: "complete", logs };
  }

  async getPendingNonce(address: Address): Promise<string> {
    await this.assertBaseChain();
    return rpcQuantity(await this.call("eth_getTransactionCount", [address, "pending"])).toString();
  }

  async estimateDirectTransfer(input: { readonly from: Address; readonly to: Address; readonly data: Hex }): Promise<FeeEstimate> {
    if (input.to !== BASE_USDC) throw new ApnError("APN_INVALID_INPUT", "Only exact Base USDC is supported.");
    return await this.estimateTransaction(input);
  }

  async estimateTransaction(input: { readonly from: Address; readonly to: Address; readonly data: Hex }): Promise<FeeEstimate> {
    await this.assertBaseChain();
    const gas = rpcQuantity(await this.call("eth_estimateGas", [{ from: input.from, to: input.to, data: input.data, value: "0x0" }]));
    const priority = rpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
    const block = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
    const baseFee = rpcQuantity(block.baseFeePerGas);
    return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: (baseFee * 2n + priority).toString(), maxPriorityFeePerGasAtomic: priority.toString() };
  }

  /** The pre-transport refusal a guarded POST would meet now (cap spent, provider cooling down); sends nothing. */
  async assertPostCapacity(): Promise<void> { await this.directGuard?.assertCanPost(this.endpoint.toString()); }

  async submitRawTransaction(rawTransaction: Hex, beforeSend?: () => void): Promise<Hex> {
    try { return rpcHex(await this.call("eth_sendRawTransaction", [rawTransaction], beforeSend), 32); }
    catch (error) {
      if (error instanceof ApnError && (error.code === "APN_RPC_BUDGET_EXCEEDED" || error.code === "APN_PROVIDER_UNAVAILABLE")) throw error;
      if (error instanceof ApnError && error.details?.httpStatus === 429) throw error;
      throw new ApnError("APN_RPC_AMBIGUOUS", "Transaction submission outcome is ambiguous.");
    }
  }

  async getReceipt(transactionHash: Hex): Promise<RpcReceipt | null> {
    await this.assertBaseChain();
    const raw = await this.call("eth_getTransactionReceipt", [transactionHash]);
    if (raw === null) return null;
    const receipt = record(raw, "transaction receipt");
    const status = rpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt status is invalid.");
    if (!Array.isArray(receipt.logs)) throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt logs are invalid.");
    const logs: RpcLog[] = receipt.logs.map((entry: unknown) => {
      const log = record(entry, "receipt log");
      if (!Array.isArray(log.topics)) throw new ApnError("APN_RPC_PROTOCOL", "RPC log topics are invalid.");
      return { address: rpcAddress(log.address), topics: log.topics.map((topic: unknown) => rpcHex(topic, 32)), data: rpcHex(log.data) };
    });
    return { transactionHash: rpcHex(receipt.transactionHash, 32), status: status === 1n ? "success" : "reverted", blockNumberAtomic: rpcQuantity(receipt.blockNumber).toString(), logs, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin,
      evmFeeFields: readEvmReceiptFeeFields(receipt) };
  }

  async coinbaseGaslessCall(method: Parameters<NonNullable<RpcPort["coinbaseGaslessCall"]>>[0],
    params: readonly unknown[]): Promise<unknown> {
    return await this.call(method, params);
  }

  async coinbaseGaslessLogs(filter: Readonly<Record<string, unknown>>): Promise<readonly unknown[]> {
    const result = await this.callX402Logs([filter]);
    if (result.kind !== "complete" || !Array.isArray(result.value) || result.value.length > MAX_X402_LOGS) {
      throw new ApnError("APN_RPC_AMBIGUOUS", "Coinbase gasless log observation is unavailable.");
    }
    return result.value;
  }

  private async call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown> {
    const id = (++this.sequence).toString();
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const addresses = await (this.pinnedAddresses ??= this.resolvePublicAddresses());
    const raw = await this.postDirectGuarded(body, addresses, method, beforeSend);
    return parseRpcResultEnvelope(raw, id, method);
  }

  async batchCall(calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]> {
    if (!Array.isArray(calls) || calls.length < 1 || calls.length > MAX_RPC_BATCH_CALLS ||
      calls.some((call) => call === null || typeof call !== "object" ||
        !Array.isArray(call.params) || !readOnlyBatchMethod(call.method, call.params))) {
      throw new ApnError("APN_INVALID_INPUT", "RPC batch contains an invalid read request.");
    }
    const ids = calls.map(() => {
      this.sequence += 1n;
      if (this.sequence > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ApnError("APN_RPC_PROTOCOL", "RPC batch ID range is exhausted.");
      }
      return Number(this.sequence);
    });
    const body = JSON.stringify(calls.map((call, index) => ({
      jsonrpc: "2.0", id: ids[index], method: call.method, params: call.params,
    })));
    if (Buffer.byteLength(body) > MAX_RPC_RESPONSE_BYTES) {
      throw new ApnError("APN_INVALID_INPUT", "RPC batch request exceeds the size limit.");
    }
    const addresses = await (this.pinnedAddresses ??= this.resolvePublicAddresses());
    const raw = await this.postDirectGuarded(body, addresses, "batch");
    return parseRpcBatchResultEnvelope(raw, ids);
  }

  private async callX402Logs(params: readonly unknown[]): Promise<
    | { readonly kind: "complete"; readonly value: unknown }
    | { readonly kind: "pruned" }
    | { readonly kind: "range_unavailable" }
  > {
    const id = (++this.sequence).toString();
    const body = JSON.stringify({ jsonrpc: "2.0", id, method: "eth_getLogs", params });
    const addresses = await (this.pinnedAddresses ??= this.resolvePublicAddresses());
    const raw = await postJson(this.endpoint, body, addresses, this.remainingTimeoutMs(), "eth_getLogs", true);
    return parseRpcLogEnvelope(raw, id);
  }

  private async resolvePublicAddresses(): Promise<readonly PinnedAddress[]> {
    return await resolvePublicAddresses(this.endpoint, "APN_RPC_CONFIG", "RPC endpoint");
  }

  private async postDirectGuarded(body: string, addresses: readonly PinnedAddress[], method: string, beforeSend?: () => void): Promise<string> {
    this.observationCounters.attempts += 1;
    const post = () => {
      if (this.abortSignal?.aborted) throw new ApnError("APN_RPC_AMBIGUOUS", "Bounded RPC observation reached its deadline.");
      this.observationCounters.admissions += 1;
      return postJson(this.endpoint, body, addresses, this.remainingTimeoutMs(), method, false, this.abortSignal, this.observationCounters, beforeSend);
    };
    return this.directGuard === undefined ? await post() : await this.directGuard.post(this.endpoint.toString(), post);
  }

  private remainingTimeoutMs(): number {
    if (this.totalDeadlineMs === undefined) return 20_000;
    const remaining = Math.floor(this.totalDeadlineMs - performance.now());
    if (remaining < 1) throw new ApnError("APN_RPC_AMBIGUOUS", "Bounded x402 RPC observation reached its deadline.");
    return Math.min(20_000, remaining);
  }
}

/** decimals() must be a uint8 and the fresh nonce must read unused (a canonical false); anything else is not EIP-3009. */
function tokenFacts(decimals: unknown, state: unknown): NonNullable<X402PrepareEvidence["tokenFacts"]> {
  const places = BigInt(rpcHex(decimals, 32)), used = BigInt(rpcHex(state, 32));
  if (places > 255n) throw new ApnError("APN_RPC_PROTOCOL", "The x402 token's decimals() is not a uint8.", { reason: "x402_token_decimals_invalid" });
  if (used !== 0n) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "The x402 token does not answer EIP-3009 authorizationState for a fresh nonce with false.",
      { reason: "x402_token_not_eip3009" });
  }
  return { decimals: Number(places), nonceUnused: true };
}
