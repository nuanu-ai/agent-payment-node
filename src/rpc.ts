import { request as httpsRequest } from "node:https";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { record, rpcAddress, rpcQuantity, rpcHex, rpcUint256Data, rpcString, nonzeroBytes32, x402RpcLog } from "./base-rpc-codec.js";
import { x402Network } from "./x402-network.js";
import type { EvmChainId } from "./evm-asset.js";
import { exactKeys, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_ID, MAX_NONCE_SCAN_BLOCKS, MAX_RPC_RESPONSE_BYTES, TRANSFER_TOPIC } from "./constants.js";
import { ApnError } from "./errors.js";
import { jsonRpcRequestHeaders } from "./rpc-request-headers.js";
import { EvmRpc } from "./evm-rpc.js";
import { EvmDirectRpcGuard } from "./evm-direct-rpc-guard.js";
import type { StateStore } from "./state.js";
import { parseAtomic } from "./money.js";
import type { Address, Hex } from "./model.js";
import { isPublicIp, parsePublicHttpsUrl, resolvePublicAddresses, type PinnedAddress } from "./network-policy.js";
import { parseJsonWithDuplicateRejection } from "./x402-strict-json.js";
import type {
  BalanceSnapshot,
  FeeEstimate,
  RpcLog,
  RpcPort,
  RpcReceipt,
  X402AuthorizationState,
  X402AuthorizationUsedLogs,
  X402BlockReference,
  X402PrepareEvidence,
  X402RpcBlock,
  X402RpcHead,
  X402RpcLog,
  X402RpcPort,
  X402RpcReceipt,
  X402TransferLogs,
} from "./ports.js";

const AUTHORIZATION_STATE_SELECTOR = "0xe94a0102";
const AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const MAX_X402_LOGS = 256;
const MAX_RPC_BATCH_CALLS = 16;
const MAX_RPC_BATCH_ENVELOPES = 24;
const BATCH_READ_METHODS = new Set([
  "eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_call",
  "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_gasPrice",
  "eth_maxPriorityFeePerGas", "eth_estimateGas",
]);

export type ReadOnlyRpcBatchCall = { readonly method: string; readonly params: readonly unknown[] };

export class HttpsBaseRpc implements RpcPort, X402RpcPort {
  readonly evm: EvmRpc;
  readonly endpoint: URL;
  readonly rpcOrigin: string;
  private sequence = 0n;
  private readonly x402ChainId: EvmChainId;
  private pinnedAddresses: Promise<readonly PinnedAddress[]> | undefined;
  private readonly totalDeadlineMs: number | undefined;
  private readonly abortSignal: AbortSignal | undefined;
  private directGuard: EvmDirectRpcGuard | undefined;
  private readonly directGuardState: StateStore | undefined;

  constructor(endpoint: string, options: { readonly totalDeadlineMs?: number; readonly x402ChainId?: EvmChainId;
    readonly abortSignal?: AbortSignal; readonly directGuardState?: StateStore } = {}) {
    const parsed = parsePublicHttpsUrl(endpoint, "APN_RPC_CONFIG", "RPC endpoint");
    this.endpoint = parsed;
    this.rpcOrigin = parsed.origin;
    this.evm = new EvmRpc((method, params) => this.call(method, params), this.rpcOrigin, undefined,
      (calls) => this.batchCall(calls));
    this.totalDeadlineMs = options.totalDeadlineMs;
    this.abortSignal = options.abortSignal;
    this.directGuardState = options.directGuardState;
    this.x402ChainId = x402Network(options.x402ChainId).chainId;
  }

  armBnbDirectRpcGuard(): void {
    this.armEvmDirectRpcGuard();
  }

  armEvmDirectRpcGuard(): void {
    if (this.directGuardState === undefined) throw new ApnError("APN_RPC_CONFIG", "Direct EVM RPC guard state is unavailable.");
    this.directGuard ??= new EvmDirectRpcGuard(this.directGuardState);
  }

  /** Relay uses a single cancellation signal for all POSTs in one execute invocation. */
  withAbortSignal(signal: AbortSignal): HttpsBaseRpc {
    const selected = new HttpsBaseRpc(this.endpoint.toString(), { abortSignal: signal, x402ChainId: this.x402ChainId });
    selected.pinnedAddresses = this.pinnedAddresses;
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
      x402ChainId: this.x402ChainId,
    });
    bounded.pinnedAddresses = this.pinnedAddresses;
    return bounded;
  }

  forX402Network(chainId: EvmChainId): HttpsBaseRpc {
    const selected = new HttpsBaseRpc(this.endpoint.toString(), {
      x402ChainId: chainId, ...(this.totalDeadlineMs === undefined ? {} : { totalDeadlineMs: this.totalDeadlineMs }),
    });
    selected.pinnedAddresses = this.pinnedAddresses;
    return selected;
  }

  async assertX402Chain(chainId: EvmChainId): Promise<{ readonly chainId: EvmChainId; readonly rpcOrigin: string }> {
    if (chainId !== this.x402ChainId) throw new ApnError("APN_CHAIN_MISMATCH", "x402 RPC binding belongs to another network.");
    await this.evm.assertChain(chainId);
    return { chainId, rpcOrigin: this.rpcOrigin };
  }

  async assertBaseChain(): Promise<{ readonly chainId: 8453; readonly rpcOrigin: string }> {
    const chainId = rpcQuantity(await this.call("eth_chainId", []));
    if (chainId !== BigInt(CHAIN_ID)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC endpoint is not Base chain ID 8453.");
    return { chainId: CHAIN_ID, rpcOrigin: this.rpcOrigin };
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

  async getX402PrepareEvidence(address: Address): Promise<X402PrepareEvidence> {
    const block = record(await this.call("eth_getBlockByNumber", ["safe", false]), "safe block");
    const tag = block.number;
    const number = rpcQuantity(tag).toString();
    const hash = rpcHex(block.hash, 32);
    const timestamp = rpcQuantity(block.timestamp).toString();
    const balanceData = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
    const [balance, name, version, domainSeparator] = await Promise.all([
      this.call("eth_call", [{ to: x402Network(this.x402ChainId).token, data: balanceData }, tag]),
      this.call("eth_call", [{ to: x402Network(this.x402ChainId).token, data: "0x06fdde03" }, tag]),
      this.call("eth_call", [{ to: x402Network(this.x402ChainId).token, data: "0x54fd4d50" }, tag]),
      this.call("eth_call", [{ to: x402Network(this.x402ChainId).token, data: "0x3644e515" }, tag]),
    ]);
    const recheckedBlock = record(await this.call("eth_getBlockByNumber", [tag, false]), "rechecked pinned block");
    const recheckedNumber = rpcQuantity(recheckedBlock.number).toString();
    const recheckedHash = rpcHex(recheckedBlock.hash, 32);
    const recheckedTimestamp = rpcQuantity(recheckedBlock.timestamp).toString();
    if (recheckedNumber !== number || recheckedHash !== hash || recheckedTimestamp !== timestamp) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC pinned block identity changed around the x402 reads.");
    }
    return {
      address,
      usdcAtomic: rpcUint256Data(balance, "USDC balance"),
      tokenName: rpcString(name, "token name"),
      tokenVersion: rpcString(version, "token version"),
      domainSeparator: rpcHex(domainSeparator, 32),
      rpcOriginHash: sha256(this.rpcOrigin),
      observedAt: new Date().toISOString(),
      queriedTag: "safe",
      block: { number, hash, timestamp },
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
    const encoded = rpcHex(await this.call("eth_call", [{ to: x402Network(this.x402ChainId).token, data }, tag]), 32);
    const value = BigInt(encoded);
    if (value !== 0n && value !== 1n) throw new ApnError("APN_RPC_PROTOCOL", "RPC authorization state is not a canonical boolean.");
    return {
      value: value === 1n,
      blockNumber: identity.number,
      blockHash: identity.hash,
      blockTag: "tag" in block ? block.tag : "number",
      observedAt: new Date().toISOString(),
      rpcOrigin: this.rpcOrigin,
    };
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
      address: x402Network(this.x402ChainId).token,
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
        log.address.toLowerCase() !== x402Network(this.x402ChainId).token.toLowerCase() || log.topics.length !== 3 ||
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
    readonly fromBlock: string;
    readonly toBlock: string;
  }): Promise<X402TransferLogs> {
    const from = parseAtomic(input.fromBlock);
    const to = parseAtomic(input.toBlock);
    if (from > to || to - from + 1n > 2048n) throw new ApnError("APN_RPC_PROTOCOL", "RPC Transfer range exceeds the fixed bound.");
    const fromTopic = `0x${input.from.slice(2).toLowerCase().padStart(64, "0")}`;
    const result = await this.callX402Logs([{
      address: x402Network(this.x402ChainId).token,
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
      topics: [TRANSFER_TOPIC, fromTopic],
    }]);
    if (result.kind !== "complete") return result;
    if (!Array.isArray(result.value) || result.value.length > MAX_X402_LOGS) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC Transfer logs exceed the fixed bound.");
    }
    const logs = result.value.map((entry: unknown) => x402RpcLog(entry));
    for (const log of logs) {
      if (
        log.address.toLowerCase() !== x402Network(this.x402ChainId).token.toLowerCase() || log.topics.length !== 3 ||
        log.topics[0] !== TRANSFER_TOPIC || log.topics[1] !== fromTopic || log.data.length !== 66 ||
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

  async submitRawTransaction(rawTransaction: Hex): Promise<Hex> {
    try { return rpcHex(await this.call("eth_sendRawTransaction", [rawTransaction]), 32); }
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
    return { transactionHash: rpcHex(receipt.transactionHash, 32), status: status === 1n ? "success" : "reverted", blockNumberAtomic: rpcQuantity(receipt.blockNumber).toString(), logs, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin };
  }

  async getLatestConfirmedNonce(address: Address): Promise<string> {
    await this.assertBaseChain();
    return rpcQuantity(await this.call("eth_getTransactionCount", [address, "latest"])).toString();
  }

  async getConfirmedTransactionAtNonce(address: Address, nonceAtomic: string, startBlockNumberAtomic: string): Promise<Hex | null> {
    await this.assertBaseChain();
    const latestBlock = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
    const latest = rpcQuantity(latestBlock.number);
    const requestedStart = parseAtomic(startBlockNumberAtomic);
    const boundedStart = latest >= MAX_NONCE_SCAN_BLOCKS - 1n ? latest - (MAX_NONCE_SCAN_BLOCKS - 1n) : 0n;
    const start = requestedStart > boundedStart ? requestedStart : boundedStart;
    for (let blockNumber = latest; blockNumber >= start; blockNumber -= 1n) {
      const tag = `0x${blockNumber.toString(16)}`;
      const block = record(await this.call("eth_getBlockByNumber", [tag, true]), "confirmed block");
      if (!Array.isArray(block.transactions)) throw new ApnError("APN_RPC_PROTOCOL", "RPC block transactions are invalid.");
      for (const item of block.transactions) {
        const transaction = record(item, "block transaction");
        if (typeof transaction.from === "string" && transaction.from.toLowerCase() === address.toLowerCase() && rpcQuantity(transaction.nonce).toString() === nonceAtomic) {
          return rpcHex(transaction.hash, 32);
        }
      }
      if (blockNumber === 0n) break;
    }
    return null;
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

  private async call(method: string, params: readonly unknown[]): Promise<unknown> {
    const id = (++this.sequence).toString();
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const addresses = await (this.pinnedAddresses ??= this.resolvePublicAddresses());
    const raw = await this.postDirectGuarded(body, addresses, method);
    return parseRpcResultEnvelope(raw, id, method);
  }

  async batchCall(calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]> {
    if (!Array.isArray(calls) || calls.length < 1 || calls.length > MAX_RPC_BATCH_CALLS ||
      calls.some((call) => call === null || typeof call !== "object" ||
        !BATCH_READ_METHODS.has(call.method) || !Array.isArray(call.params))) {
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

  private async postDirectGuarded(body: string, addresses: readonly PinnedAddress[], method: string): Promise<string> {
    const post = () => postJson(this.endpoint, body, addresses, this.remainingTimeoutMs(), method, false, this.abortSignal);
    return this.directGuard === undefined ? await post() : await this.directGuard.post(this.endpoint.toString(), post);
  }

  private remainingTimeoutMs(): number {
    if (this.totalDeadlineMs === undefined) return 20_000;
    const remaining = Math.floor(this.totalDeadlineMs - performance.now());
    if (remaining < 1) throw new ApnError("APN_RPC_AMBIGUOUS", "Bounded x402 RPC observation reached its deadline.");
    return Math.min(20_000, remaining);
  }
}

export function parseRpcResultEnvelope(raw: string, id: string, method?: string): unknown {
  const message = strictRpcRecord(raw);
  if (!exactKeys(message, ["jsonrpc", "id", "result"]) || message.jsonrpc !== "2.0" || message.id !== id) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC response violates the exact JSON-RPC result envelope.", {
      rpcMethod: method !== undefined && (BATCH_READ_METHODS.has(method) || method === "eth_sendRawTransaction") ? method : "unknown",
      stage: "result_envelope",
    });
  }
  return message.result;
}

export function parseRpcBatchResultEnvelope(raw: string, ids: readonly number[]): readonly unknown[] {
  if (ids.length < 1 || ids.length > MAX_RPC_BATCH_CALLS ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC batch request IDs are invalid.");
  }
  if (Buffer.byteLength(raw) > MAX_RPC_RESPONSE_BYTES) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit.");
  }
  let parsed: unknown;
  try { parsed = parseJsonWithDuplicateRejection(raw); }
  catch { throw new ApnError("APN_RPC_PROTOCOL", "RPC response is not strict JSON."); }
  if (!Array.isArray(parsed) || parsed.length < ids.length || parsed.length > MAX_RPC_BATCH_ENVELOPES) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response count is invalid.");
  }
  const expected = new Set(ids);
  const results = new Map<number, Record<string, unknown>>();
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response envelope is invalid.");
    }
    const message = entry as Record<string, unknown>;
    if (!exactKeys(message, ["jsonrpc", "id", "result"]) || message.jsonrpc !== "2.0" ||
      typeof message.id !== "number" || !Number.isSafeInteger(message.id) || !expected.has(message.id)) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response envelope is invalid.");
    }
    const previous = results.get(message.id);
    if (previous !== undefined && !isDeepStrictEqual(previous, message)) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response envelope is invalid.");
    }
    results.set(message.id, message);
  }
  if (results.size !== ids.length) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response is missing an ID.");
  }
  return ids.map((id) => results.get(id)!.result);
}

export function parseRpcLogEnvelope(raw: string, id: string):
  | { readonly kind: "complete"; readonly value: unknown }
  | { readonly kind: "pruned" }
  | { readonly kind: "range_unavailable" } {
  const message = strictRpcRecord(raw);
  if (message.jsonrpc !== "2.0" || message.id !== id) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC response violates JSON-RPC identity requirements.");
  }
  if (exactKeys(message, ["jsonrpc", "id", "result"])) return { kind: "complete", value: message.result };
  if (!exactKeys(message, ["jsonrpc", "id", "error"])) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC log response violates the exact result or error envelope.");
  }
  const error = record(message.error, "JSON-RPC error");
  const availability = classifyX402LogAvailabilityMessage(typeof error.message === "string" ? error.message : "");
  if (availability !== null) return { kind: availability };
  throw new ApnError("APN_RPC_PROTOCOL", "RPC log query failed without a recognized availability class.");
}

function strictRpcRecord(raw: string): Record<string, unknown> {
  try { return record(parseJsonWithDuplicateRejection(raw), "JSON-RPC response"); }
  catch (error) {
    if (error instanceof ApnError && error.code === "APN_RPC_PROTOCOL") throw error;
    throw new ApnError("APN_RPC_PROTOCOL", "RPC response is not strict JSON.");
  }
}

export function classifyX402LogAvailabilityMessage(
  message: string,
): "pruned" | "range_unavailable" | null {
  const text = message.toLowerCase();
  if (/\b(?:rate[ -]limit(?:ed|ing)?|request limit|too many requests)\b/u.test(text)) return null;
  if (/\b(?:pruned|missing trie|historical state|history unavailable)\b/u.test(text)) return "pruned";
  const rangeSubject = /\b(?:block(?:s)?|range|logs?|results?|query|window)\b/u.test(text);
  const boundedFailure = /\b(?:too (?:wide|large)|too many results?|exceed(?:s|ed|ing)?|maximum|max|limit(?:ed)?|more than|returned more|at most|up to)\b/u.test(text);
  return rangeSubject && boundedFailure ? "range_unavailable" : null;
}

async function postJson(
  endpoint: URL,
  body: string,
  addresses: readonly PinnedAddress[],
  timeoutMs: number,
  rpcMethod: string,
  allowJsonRpcClientError = false,
  abortSignal?: AbortSignal,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const selected = addresses[0];
    if (selected === undefined) { reject(new ApnError("APN_RPC_CONFIG", "RPC host has no validated address.")); return; }
    let requestTimedOut = false;
    const request = httpsRequest(endpoint, {
      method: "POST",
      signal: abortSignal,
      family: selected.family,
      headers: jsonRpcRequestHeaders(body),
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      const details = { rpcMethod, ...(response.statusCode === undefined ? {} : { httpStatus: response.statusCode }) };
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
        response.resume(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC redirects are forbidden.", details)); return;
      }
      if (!acceptRpcHttpBody(response.statusCode, allowJsonRpcClientError)) {
        response.resume(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC returned an unsuccessful HTTP status.", details)); return;
      }
      const declared = Number(response.headers["content-length"] ?? "0");
      if (Number.isFinite(declared) && declared > MAX_RPC_RESPONSE_BYTES) { response.destroy(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit.")); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_RPC_RESPONSE_BYTES) { response.destroy(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => { if (!abortSignal?.aborted && !requestTimedOut) resolve(Buffer.concat(chunks, total).toString("utf8")); });
      response.on("error", () => { if (!abortSignal?.aborted && !requestTimedOut) reject(new ApnError("APN_RPC_AMBIGUOUS", "RPC response failed safely.")); });
    });
    request.setTimeout(timeoutMs, () => { requestTimedOut = true; request.destroy(); });
    request.on("error", (error) => {
      // Abort rejects only after close, when the underlying HTTPS request has stopped.
      if (abortSignal?.aborted || requestTimedOut) return;
      reject(error instanceof ApnError ? error : new ApnError("APN_RPC_AMBIGUOUS", "RPC transport failed safely."));
    });
    request.on("close", () => {
      if (abortSignal?.aborted) reject(new ApnError("APN_RPC_BUDGET_EXCEEDED",
        "Relay execution reached its wall deadline; resume the saved operation explicitly.", { reason: "relay_wall_deadline" }));
      else if (requestTimedOut) reject(new ApnError("APN_RPC_AMBIGUOUS", "RPC request timed out."));
    });
    request.end(body);
  });
}

export { isPublicIp } from "./network-policy.js";
export function acceptRpcHttpBody(status: number | undefined, allowJsonRpcClientError: boolean): boolean {
  return status === 200 || (allowJsonRpcClientError && status === 400);
}
