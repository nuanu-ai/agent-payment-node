import { hashObject } from "../canonical.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import type { Address, Hex } from "../model.js";
import type { BridgeBlock, BridgeLog } from "./model.js";
import { bridgeFailure, bridgeHex } from "./validation.js";

export function exactNativeTransfer(value: unknown, transactionHash: Hex, expected: Readonly<{ recipient: Address; from: Address; amountAtomic?: string; minimumAmountAtomic?: string }>) {
  if ((expected.amountAtomic === undefined) === (expected.minimumAmountAtomic === undefined)) bridgeFailure("APN_INTERNAL", "native_transfer_bound");
  const rows: Array<{ type: "CALL"; from: Address; to: Address; valueAtomic: string; path: string }> = [];
  const visit = (raw: unknown, path: string, depth: number): void => {
    if (depth > 32 || rows.length > 1024) bridgeFailure("APN_RPC_PROTOCOL", "native_trace_bound");
    const call = evmRpcRecord(raw), from = evmRpcAddress(call.from), to = evmRpcAddress(call.to), valueAtomic = evmRpcQuantity(call.value ?? "0x0").toString();
    const bounded = expected.amountAtomic === undefined ? BigInt(valueAtomic) >= BigInt(expected.minimumAmountAtomic!) : valueAtomic === expected.amountAtomic;
    if (call.type === "CALL" && call.error === undefined && from === expected.from && to === expected.recipient && bounded) rows.push({ type: "CALL", from, to, valueAtomic, path });
    if (call.calls !== undefined) {
      if (!Array.isArray(call.calls) || call.calls.length > 256) bridgeFailure("APN_RPC_PROTOCOL", "native_trace_calls");
      call.calls.forEach((child, index) => visit(child, `${path}.${index}`, depth + 1));
    }
  };
  visit(value, "0", 0);
  if (rows.length !== 1) bridgeFailure("APN_RPC_PROTOCOL", "native_destination_transfer");
  return { transactionHash, from: expected.from, to: expected.recipient, valueAtomic: rows[0]!.valueAtomic, traceHash: hashObject({ transactionHash, delivery: rows[0] }) };
}

export function parseReceiptLogs(value: unknown, hash: Hex, block: BridgeBlock, transactionIndex: bigint): readonly BridgeLog[] {
  if (!Array.isArray(value) || value.length > 256) bridgeFailure("APN_RPC_PROTOCOL", "receipt_log_count");
  const indices = new Set<string>();
  return value.map((value) => {
    const l = evmRpcRecord(value), index = evmRpcQuantity(l.logIndex).toString();
    if (indices.has(index) || evmRpcHex(l.transactionHash, 32) !== hash || evmRpcHex(l.blockHash, 32) !== block.hash ||
      evmRpcQuantity(l.blockNumber).toString() !== block.numberAtomic || evmRpcQuantity(l.transactionIndex) !== transactionIndex || l.removed !== false || !Array.isArray(l.topics) || l.topics.length > 4) bridgeFailure("APN_RPC_PROTOCOL", "receipt_log_membership");
    indices.add(index);
    return { address: evmRpcAddress(l.address), topics: l.topics.map((v) => evmRpcHex(v, 32)), data: bridgeHex(l.data, 64 * 1024, undefined, "APN_RPC_PROTOCOL") };
  });
}
