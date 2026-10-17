import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import type { Hex } from "../model.js";
import { verifyBnbCompositeTrace } from "./bnb-composite.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeDestinationTransactionProof, BridgeEnvelope, BridgeProtocolReceipt, BridgeTransactionProof } from "./model.js";
import type { BridgeObservationOptions, BridgeRpcPort } from "./ports.js";
import { hashObject } from "../canonical.js";
import { rpcBlockValue, rpcExpectedChainValue } from "./rpc-batch-codec.js";
import { bridgeActualFees } from "./rpc-fees.js";
import { exactNativeTransfer, parseReceiptLogs } from "./rpc-proof-codec.js";
import type { RpcBatchReadItem } from "./rpc-session.js";
import { quantity } from "./rpc-support.js";
import { verifyRpcTransaction } from "./rpc-transaction.js";
import { bridgeFailure, bridgeHex } from "./validation.js";

type PlannedRead = Omit<RpcBatchReadItem, "batchAttempt">;
export type BridgeBatchCall = (items: readonly PlannedRead[], route?: "primary" | "archive" | "receipt") => Promise<readonly unknown[]>;
type NativeDelivery = Parameters<BridgeRpcPort["observe"]>[2];
export interface BridgeObservationContext {
  readonly chainId: BridgeChainId;
  readonly origin: string;
  /** Single reads; the transport sends pinned history and traces to an owner-named archive, receipts to a named reader. */
  readonly call: EvmRpcCall;
  readonly batchCall: BridgeBatchCall;
  readonly receipts: Readonly<{ reader: boolean; fallback: boolean }>;
}

/**
 * Clean POSTs of one canonical observation, in the order `observeCanonical` sends them: the batch of transaction, receipt,
 * safe head and (when already known) the inclusion header; the inclusion header when it was not known; and the receipt
 * route's own reads, at most two (a one-item reader's chain identity and receipt, or an empty primary receipt's fallback).
 */
export const BRIDGE_CANONICAL_OBSERVATION_POSTS = 1 + 1 + 2;
/** A provider-bound native delivery adds the pre-delivery header, the archive chain identity, two pinned balances and the trace. */
export const BRIDGE_NATIVE_DELIVERY_POSTS = 5;

const chainItem = (chainId: BridgeChainId): PlannedRead => ({ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(chainId) });
const headerItem = (number: bigint): PlannedRead => ({ method: "eth_getBlockByNumber", params: [quantity(number), false], cachePolicy: "immutable", decoder: rpcBlockValue });
const raw = (value: unknown): unknown => value;

/**
 * One transaction's canonical inclusion: the receipt binds the transaction at its index, the inclusion header's hash
 * equals the receipt's block hash and lists the transaction there, and the safe head decides finality. Every read is
 * one batch on the primary endpoint; hash-pinned reads need no header recheck because the node enforces canonicality.
 * Fees come from the receipt (Base: `l1Fee` and the operator fee fields), never from historical oracle state.
 */
export async function observeCanonical(c: BridgeObservationContext, hash: Hex, expected: BridgeEnvelope | undefined,
  nativeDelivery: NativeDelivery, includeFees: boolean, options: BridgeObservationOptions = {}): Promise<{
    transaction: BridgeTransactionProof | BridgeDestinationTransactionProof; receipt: BridgeProtocolReceipt } | null> {
  bridgeHex(hash, 32, 32, "APN_RPC_PROTOCOL");
  const known = options.includedBlock, receiptInBatch = !c.receipts.reader;
  let rawTx: unknown, receiptRaw: unknown, safeRaw: Record<string, unknown>, knownRaw: unknown;
  const read = async (withReceipt: boolean) => {
    const values = await c.batchCall([chainItem(c.chainId),
      { method: "eth_getTransactionByHash", params: [hash], cachePolicy: "auto", decoder: raw },
      ...(withReceipt ? [{ method: "eth_getTransactionReceipt", params: [hash], cachePolicy: "auto" as const, decoder: raw }] : []),
      // One safe head per observation session: every effect of this invocation is judged against the same head.
      { method: "eth_getBlockByNumber", params: ["safe", false], cachePolicy: "snapshot", decoder: rpcBlockValue },
      ...(known === undefined ? [] : [headerItem(BigInt(known.numberAtomic))])]);
    let offset = 2;
    rawTx = values[1]; receiptRaw = withReceipt ? values[offset++] : undefined;
    safeRaw = values[offset++] as Record<string, unknown>; knownRaw = known === undefined ? undefined : values[offset];
  };
  try { await read(receiptInBatch); }
  catch (error) {
    // A pruned primary answers an old receipt with a sub-error inside the batch: read it through the receipt route instead.
    if (!receiptInBatch || !c.receipts.fallback || !(error instanceof ApnError) || error.details?.rpcMethod !== "eth_getTransactionReceipt") throw error;
    await read(false);
  }
  if (rawTx === null) return null;
  // A distinct receipt reader, or an empty or refused primary receipt with a named fallback, goes through the receipt route.
  if (receiptRaw === undefined || (receiptRaw === null && c.receipts.fallback && evmRpcRecord(rawTx).blockHash != null)) {
    receiptRaw = await c.call("eth_getTransactionReceipt", [hash]);
  }
  if (receiptRaw === null) return null;
  const tx = evmRpcRecord(rawTx), r = evmRpcRecord(receiptRaw), number = evmRpcQuantity(r.blockNumber), blockHash = evmRpcHex(r.blockHash, 32);
  if (evmRpcHex(r.transactionHash, 32) !== hash || evmRpcHex(tx.blockHash, 32) !== blockHash ||
    evmRpcQuantity(tx.blockNumber) !== number || evmRpcQuantity(tx.type) !== evmRpcQuantity(r.type) ||
    evmRpcQuantity(tx.transactionIndex) !== evmRpcQuantity(r.transactionIndex)) bridgeFailure("APN_RPC_PROTOCOL", "receipt_transaction_membership");
  const included = (known?.numberAtomic === number.toString() ? knownRaw : (await c.batchCall([chainItem(c.chainId), headerItem(number)]))[1]) as Record<string, unknown>;
  const index = evmRpcQuantity(r.transactionIndex);
  if (evmRpcHex(included.hash, 32) !== blockHash || evmRpcQuantity(included.number) !== number || !Array.isArray(included.transactions) ||
    included.transactions.length > 20_000 || index >= BigInt(included.transactions.length) ||
    included.transactions[Number(index)] !== hash) bridgeFailure("APN_RPC_PROTOCOL", "canonical_transaction_membership");
  const block = { numberAtomic: number.toString(), hash: blockHash, timestampAtomic: evmRpcQuantity(included.timestamp).toString() };
  const safe = { numberAtomic: evmRpcQuantity(safeRaw!.number).toString(), hash: evmRpcHex(safeRaw!.hash, 32), timestampAtomic: evmRpcQuantity(safeRaw!.timestamp).toString() };
  const safeBlock = BigInt(safe.numberAtomic) >= number ? safe : null;
  const status = evmRpcQuantity(r.status);
  if (status !== 0n && status !== 1n) bridgeFailure("APN_RPC_PROTOCOL", "receipt_status");
  const identity = await verifyRpcTransaction(tx, c.chainId, hash, expected);
  if (evmRpcAddress(r.from) !== identity.from || evmRpcAddress(r.to) !== identity.to) bridgeFailure("APN_RPC_PROTOCOL", "receipt_sender_target");
  const logs = parseReceiptLogs(r.logs, hash, block, index);
  const fees = !includeFees ? null : bridgeActualFees(c.chainId, r);
  if (fees !== null && (BigInt(fees.gasUsedAtomic) > BigInt(identity.gasLimitAtomic) ||
    BigInt(fees.effectiveGasPriceAtomic) > BigInt(identity.maxFeePerGasAtomic))) bridgeFailure("APN_RPC_PROTOCOL", "receipt_execution_fee_bounds");
  let nativeBalance: BridgeProtocolReceipt["nativeBalance"] = null, nativeTransfer: BridgeProtocolReceipt["nativeTransfer"] = null;
  let compositeTrace: BridgeProtocolReceipt["compositeTrace"] = null;
  if (nativeDelivery !== undefined) {
    // No logs prove a native fill: the recipient's balance across the inclusion block and the delivery call trace do.
    // These are the one genuinely historical read set; an owner-named archive serves them, else the primary for recent blocks.
    if (number === 0n) bridgeFailure("APN_RPC_PROTOCOL", "native_balance_genesis");
    const beforeRaw = (await c.batchCall([chainItem(c.chainId), headerItem(number - 1n)]))[1] as Record<string, unknown>;
    const before = { numberAtomic: (number - 1n).toString(), hash: evmRpcHex(beforeRaw.hash, 32), timestampAtomic: evmRpcQuantity(beforeRaw.timestamp).toString() };
    if (before.hash !== evmRpcHex(included.parentHash, 32)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
    const [beforeBalance, afterBalance, trace] = await Promise.all([
      c.call("eth_getBalance", [nativeDelivery.recipient, { blockHash: before.hash, requireCanonical: true }]).then(evmRpcQuantity),
      c.call("eth_getBalance", [nativeDelivery.recipient, { blockHash: block.hash, requireCanonical: true }]).then(evmRpcQuantity),
      c.call("debug_traceTransaction", [hash, { tracer: "callTracer", tracerConfig: { onlyTopCall: false, withLog: false } }]),
    ]);
    if (afterBalance < beforeBalance) bridgeFailure("APN_RPC_PROTOCOL", "native_balance_delta_negative");
    nativeBalance = { recipient: nativeDelivery.recipient, beforeBlock: before, afterBlock: block,
      beforeBalanceAtomic: beforeBalance.toString(), afterBalanceAtomic: afterBalance.toString(), deltaAtomic: (afterBalance - beforeBalance).toString() };
    if (nativeDelivery.composite === undefined) nativeTransfer = exactNativeTransfer(trace, hash, nativeDelivery);
    else compositeTrace = verifyBnbCompositeTrace(trace, hash, nativeDelivery.composite.message, nativeDelivery.composite.call,
      { sender: identity.from, calldata: bridgeHex(tx.input, 24_576, undefined, "APN_RPC_PROTOCOL") });
  }
  return { transaction: { chainId: c.chainId, transactionHash: hash, block, safeBlock, rpcOrigin: c.origin, ...identity,
    ...(fees ?? {}), status: status === 1n ? "success" : "reverted", logsHash: hashObject(logs) },
    receipt: { chainId: c.chainId, transactionHash: hash, blockNumberAtomic: number.toString(), blockHash, logs, nativeBalance, nativeTransfer, compositeTrace } };
}
