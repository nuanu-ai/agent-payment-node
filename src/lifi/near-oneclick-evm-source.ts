import { encodeFunctionData, getAddress, keccak256, pad, parseAbi, type Hex } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "../evm-asset.js";
import { CircleBaseJsonRpc } from "./circle-v2-source-service.js";
import type { BridgeHttps } from "./https.js";
import type { OneClickLane } from "./near-oneclick-lanes.js";
import type { OneClickSourceRecord } from "./near-oneclick-source-journal.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord } from "./validation.js";

const ORACLE = getAddress("0x420000000000000000000000000000000000000F");
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const FEE = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)", "function getOperatorFee(uint256) view returns (uint256)"]);
const TRANSFER_TOPIC = keccak256(Buffer.from("Transfer(address,address,uint256)"));
/** Intrinsic gas of a plain value transfer to an account without code. */
export const ONECLICK_PLAIN_TRANSFER_GAS = 21_000n;
function fail(reason: string): never { return bridgeFailure("APN_OPERATION_BLOCKED", `oneclick_source_${reason}`); }
function quantity(value: unknown): bigint { if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value)) fail("rpc_quantity"); return BigInt(value); }
function word(value: unknown): bigint { return BigInt(bridgeHex(value, 32, 32)); }
function hex(n: bigint): Hex { return `0x${n.toString(16)}`; }

export interface OneClickSourceCaps { readonly maxGas: bigint; readonly maxFee: bigint; readonly maxPriority: bigint; readonly maxNative: bigint }
export interface OneClickSourcePlan {
  readonly blockHash: Hex; readonly nonce: bigint; readonly gas: bigint; readonly fee: bigint; readonly tip: bigint;
  readonly nativeDebit: bigint; readonly depositCode: "eoa" | "contract" | null;
}
/** Raw hash-pinned Ethereum reads for a native deposit. Caps are applied once, by planOneClickNative. */
export interface OneClickNativeObservation {
  readonly blockHash: Hex; readonly nonce: bigint; readonly depositCode: "eoa" | "contract"; readonly gas: bigint;
  readonly baseFee: bigint; readonly tip: bigint; readonly balance: bigint;
}
export function assertOneClickPostApproval(initial: Readonly<{ nonce: bigint; gas: bigint; fee: bigint; tip: bigint }>,
  fresh: Readonly<{ nonce: bigint; gas: bigint; fee: bigint; tip: bigint; nativeDebit: bigint }>,
  maxNativeDebit: bigint, effectiveDeadlineMs: number, nowMs: number): void {
  if (fresh.nonce !== initial.nonce || fresh.gas > initial.gas || fresh.fee > initial.fee ||
    fresh.tip > initial.tip || fresh.nativeDebit > maxNativeDebit ||
    nowMs > effectiveDeadlineMs - 30_000) fail("post_approval_drift");
}
/** Native debit is exactly value plus gas times the signed max fee; both must fit the owner's caps and the pinned balance. */
export function planOneClickNative(observed: OneClickNativeObservation, amount: bigint, caps: OneClickSourceCaps): OneClickSourcePlan {
  const fee = 2n * observed.baseFee + observed.tip, nativeDebit = amount + observed.gas * fee;
  if (observed.gas > caps.maxGas || fee > caps.maxFee || observed.tip > caps.maxPriority) fail("gas_fee");
  if (nativeDebit > caps.maxNative || observed.balance < nativeDebit) fail("native_balance_or_cap");
  return { blockHash: observed.blockHash, nonce: observed.nonce, gas: observed.gas, fee, tip: observed.tip, nativeDebit,
    depositCode: observed.depositCode };
}
/**
 * Ethereum base fee and tip suggestions move every block, while the signed envelope keeps the approved values.
 * After consent require the same nonce and deposit code class, no larger gas need, an approved max fee that still
 * covers the fresh base fee plus the approved tip, and a fresh pinned balance that still covers the exact approved debit.
 */
export function assertOneClickNativePostApproval(initial: OneClickSourcePlan, fresh: OneClickNativeObservation, amount: bigint,
  effectiveDeadlineMs: number, nowMs: number): void {
  if (fresh.nonce !== initial.nonce || fresh.depositCode !== initial.depositCode || fresh.gas > initial.gas ||
    fresh.baseFee + initial.tip > initial.fee || initial.nativeDebit !== amount + initial.gas * initial.fee ||
    fresh.balance < initial.nativeDebit || nowMs > effectiveDeadlineMs - 30_000) fail("post_approval_drift");
}

/** One lane's EVM origin through the existing bounded JSON-RPC reader; the URL comes only from the lane's env variable. */
export class OneClickEvmSource {
  private readonly rpc: CircleBaseJsonRpc;
  constructor(private readonly lane: OneClickLane, private readonly url: string, private readonly https: Pick<BridgeHttps, "request">) {
    this.rpc = new CircleBaseJsonRpc(url, https);
  }
  private async chain(): Promise<void> {
    if (quantity(await this.rpc.call("eth_chainId", [])) !== BigInt(this.lane.origin.chainId)) fail("chain");
  }
  /** Base USDC: hash-pinned token, native, nonce, simulation and OP-stack fee reads (unchanged lane behaviour). */
  async readToken(payer: string, data: Hex, amount: bigint, caps: OneClickSourceCaps, effectiveDeadlineMs: number, now: () => number): Promise<OneClickSourcePlan> {
    const token = this.lane.origin.token;
    if (this.lane.origin.kind !== "erc20" || this.lane.origin.chainId !== 8453 || token === null) fail("token_origin");
    const rpc = this.rpc; await this.chain();
    const block = bridgeRecord(await rpc.call("eth_getBlockByNumber", ["safe", false]));
    const blockHash = bridgeHex(block.hash, 32, 32) as Hex, blockNumber = quantity(block.number);
    const tag = { blockHash, requireCanonical: true };
    const [tokenBalance, nativeBalance, latest, pending, gasEstimate, tipEstimate, simulation] = await Promise.all([
      rpc.call("eth_call", [{ to: token, data: encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [getAddress(payer)] }) }, tag]),
      rpc.call("eth_getBalance", [payer, tag]), rpc.call("eth_getTransactionCount", [payer, "latest"]),
      rpc.call("eth_getTransactionCount", [payer, "pending"]),
      rpc.call("eth_estimateGas", [{ from: payer, to: token, data, value: "0x0" }, tag]),
      rpc.call("eth_maxPriorityFeePerGas", []),
      rpc.call("eth_call", [{ from: payer, to: token, data, value: "0x0" }, tag]),
    ]);
    const nonce = quantity(latest);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || word(tokenBalance) < amount || nonce !== quantity(pending) ||
      bridgeHex(simulation, 32, 32) !== `0x${"0".repeat(63)}1`) fail("balance_nonce_or_simulation");
    const gas = quantity(gasEstimate) * 12n / 10n + 1n;
    const tip = quantity(tipEstimate), fee = 2n * quantity(block.baseFeePerGas) + tip;
    if (gas > caps.maxGas || fee > caps.maxFee || tip > caps.maxPriority) fail("gas_fee");
    const [l1, operator] = await Promise.all([
      rpc.call("eth_call", [{ to: ORACLE, data: encodeFunctionData({ abi: FEE, functionName: "getL1FeeUpperBound", args: [BigInt(MAX_DIRECT_TRANSACTION_BYTES)] }) }, tag]),
      rpc.call("eth_call", [{ to: ORACLE, data: encodeFunctionData({ abi: FEE, functionName: "getOperatorFee", args: [gas] }) }, tag]),
    ]);
    const nativeDebit = gas * fee + word(l1) + word(operator);
    if (nativeDebit > caps.maxNative || quantity(nativeBalance) < nativeDebit) fail("native_balance_or_cap");
    const check = bridgeRecord(await rpc.call("eth_getBlockByNumber", [hex(blockNumber), false]));
    if (bridgeHex(check.hash, 32, 32) !== blockHash || now() > effectiveDeadlineMs - 45_000) fail("block_or_quote_expired");
    return { blockHash, nonce, gas, fee, tip, nativeDebit, depositCode: null };
  }
  /** Ethereum ETH: balance and deposit code pinned to the safe block; the base fee reference is max(safe, latest). */
  async observeNative(payer: string, deposit: string, amount: bigint): Promise<OneClickNativeObservation> {
    if (this.lane.origin.kind !== "native" || this.lane.origin.chainId !== 1) fail("native_origin");
    const rpc = this.rpc; await this.chain();
    const [safeValue, latestValue] = await Promise.all([rpc.call("eth_getBlockByNumber", ["safe", false]),
      rpc.call("eth_getBlockByNumber", ["latest", false])]);
    const safe = bridgeRecord(safeValue), latest = bridgeRecord(latestValue);
    const blockHash = bridgeHex(safe.hash, 32, 32) as Hex, blockNumber = quantity(safe.number);
    bridgeHex(latest.hash, 32, 32);
    if (quantity(latest.number) < blockNumber) fail("block_order");
    const tag = { blockHash, requireCanonical: true };
    const [code, balance, latestNonce, pendingNonce, tip] = await Promise.all([
      this.raw("eth_getCode", [deposit, tag]), rpc.call("eth_getBalance", [payer, tag]),
      rpc.call("eth_getTransactionCount", [payer, "latest"]), rpc.call("eth_getTransactionCount", [payer, "pending"]),
      rpc.call("eth_maxPriorityFeePerGas", []),
    ]);
    const depositCode = bridgeHex(code, 128 * 1024) === "0x" ? "eoa" as const : "contract" as const;
    // A contract deposit may spend more than the intrinsic gas; estimate it at the same pinned block instead of assuming 21000.
    const gas = depositCode === "eoa" ? ONECLICK_PLAIN_TRANSFER_GAS
      : quantity(await rpc.call("eth_estimateGas", [{ from: payer, to: deposit, value: hex(amount) }, tag])) * 12n / 10n + 1n;
    const nonce = quantity(latestNonce);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || nonce !== quantity(pendingNonce)) fail("nonce");
    const safeFee = quantity(safe.baseFeePerGas), latestFee = quantity(latest.baseFeePerGas);
    const check = bridgeRecord(await rpc.call("eth_getBlockByNumber", [hex(blockNumber), false]));
    if (bridgeHex(check.hash, 32, 32) !== blockHash) fail("block_reorg");
    await this.chain();
    return { blockHash, nonce, depositCode, gas, baseFee: safeFee > latestFee ? safeFee : latestFee, tip: quantity(tip), balance: quantity(balance) };
  }
  async send(raw: Hex): Promise<Hex> { return await this.rpc.send(raw); }
  /** Safe-block receipt observation. It never implies destination delivery. */
  async observe(record: OneClickSourceRecord): Promise<unknown> {
    await this.chain();
    const receipt = await this.raw("eth_getTransactionReceipt", [record.transactionHash]);
    if (receipt === null) return null;
    const r = bridgeRecord(receipt);
    if (bridgeHex(r.transactionHash, 32, 32) !== record.transactionHash || bridgeAddress(r.to) !== getAddress(record.sourceCall.to) ||
      bridgeAddress(r.from) !== record.payer) fail("receipt_binding");
    const safe = bridgeRecord(await this.rpc.call("eth_getBlockByNumber", ["safe", false]));
    if (quantity(r.blockNumber) > quantity(safe.number)) return { safe: false, transactionHash: record.transactionHash };
    const included = bridgeRecord(await this.rpc.call("eth_getBlockByNumber", [r.blockNumber, false]));
    const index = quantity(r.transactionIndex), status = quantity(r.status);
    if (bridgeHex(included.hash, 32, 32) !== bridgeHex(r.blockHash, 32, 32) ||
      !Array.isArray(included.transactions) || included.transactions.length > 20_000 ||
      index >= BigInt(included.transactions.length) || included.transactions[Number(index)] !== record.transactionHash ||
      (status !== 0n && status !== 1n)) fail("receipt_block_or_membership");
    if (status === 1n && this.lane.origin.kind === "erc20") {
      if (!Array.isArray(r.logs) || r.logs.length > 256) fail("receipt_logs");
      const transfers = r.logs.filter((raw: unknown) => {
        const log = bridgeRecord(raw);
        return bridgeAddress(log.address) === getAddress(record.sourceCall.to) && Array.isArray(log.topics) && log.topics.length === 3 &&
          log.topics[0] === TRANSFER_TOPIC && log.topics[1] === pad(bridgeAddress(record.payer) as Hex).toLowerCase() &&
          log.topics[2] === pad(bridgeAddress(record.depositAddress) as Hex).toLowerCase() &&
          word(log.data) === BigInt(record.amountInAtomic) &&
          bridgeHex(log.transactionHash, 32, 32) === record.transactionHash &&
          bridgeHex(log.blockHash, 32, 32) === bridgeHex(r.blockHash, 32, 32);
      });
      if (transfers.length !== 1) fail("source_transfer_log");
    }
    const recheck = bridgeRecord(await this.rpc.call("eth_getBlockByNumber", [r.blockNumber, false]));
    if (bridgeHex(recheck.hash, 32, 32) !== bridgeHex(r.blockHash, 32, 32)) fail("receipt_reorg");
    return { safe: true, transactionHash: record.transactionHash, status: status === 1n ? "success" : "reverted",
      blockNumber: quantity(r.blockNumber).toString(), blockHash: bridgeHex(r.blockHash, 32, 32),
      receiptHash: hashObject(receipt), destinationDelivered: false };
  }
  /** Two reads outside the shared reader's method list, over the same validated endpoint and transport. */
  private async raw(method: "eth_getCode" | "eth_getTransactionReceipt", params: readonly unknown[]): Promise<unknown> {
    const response = await this.https.request(this.url, "POST", canonicalJson({ jsonrpc: "2.0", id: 1, method, params }), 1024 * 1024, "APN_RPC_CONFIG");
    if (response.status !== 200) fail("rpc_http");
    let body: Record<string, unknown>;
    try { body = bridgeRecord(JSON.parse(response.body)); } catch { return fail("rpc_json"); }
    if (body.jsonrpc !== "2.0" || body.id !== 1 || Object.hasOwn(body, "error") || !Object.hasOwn(body, "result")) fail("rpc_result");
    return body.result;
  }
}
