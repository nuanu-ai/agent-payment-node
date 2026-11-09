import { hashObject } from "../canonical.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { bridgeFailure, bridgeHex } from "./validation.js";
/**
 * The one native value CALL from the pinned payer to the recipient in a bounded callTracer tree. It is the delivery proof,
 * so it must have taken effect: the frame and every frame above it succeeded. A reverted ancestor undoes a child that
 * callTracer still reports without an error of its own. The trace is the only delivery proof, so its root must be the
 * verified transaction itself: a successful CALL with the transaction's sender, target, value and calldata. A trace of any
 * other transaction (a stale or mixed-up RPC answer) is refused. callTracer reports no hash: the trace is requested by the
 * verified one.
 */
export function exactNativeTransfer(value, transactionHash, expected, transaction) {
    if ((expected.amountAtomic === undefined) === (expected.minimumAmountAtomic === undefined))
        bridgeFailure("APN_INTERNAL", "native_transfer_bound");
    const root = evmRpcRecord(value);
    if (root.type !== "CALL" || root.error !== undefined || evmRpcAddress(root.from) !== transaction.sender ||
        evmRpcAddress(root.to) !== transaction.target || evmRpcQuantity(root.value).toString() !== transaction.valueAtomic ||
        bridgeHex(root.input, 128 * 1024, undefined, "APN_RPC_PROTOCOL") !== transaction.calldata) {
        bridgeFailure("APN_RPC_PROTOCOL", "native_trace_transaction");
    }
    const rows = [];
    const visit = (raw, path, depth, ancestorsSucceeded) => {
        if (depth > 32 || rows.length > 1024)
            bridgeFailure("APN_RPC_PROTOCOL", "native_trace_bound");
        const call = evmRpcRecord(raw), from = evmRpcAddress(call.from), to = evmRpcAddress(call.to), valueAtomic = evmRpcQuantity(call.value ?? "0x0").toString();
        const bounded = expected.amountAtomic === undefined ? BigInt(valueAtomic) >= BigInt(expected.minimumAmountAtomic) : valueAtomic === expected.amountAtomic;
        const succeeded = ancestorsSucceeded && call.error === undefined;
        if (call.type === "CALL" && succeeded && from === expected.from && to === expected.recipient && bounded)
            rows.push({ type: "CALL", from, to, valueAtomic, path });
        if (call.calls !== undefined) {
            if (!Array.isArray(call.calls) || call.calls.length > 256)
                bridgeFailure("APN_RPC_PROTOCOL", "native_trace_calls");
            call.calls.forEach((child, index) => visit(child, `${path}.${index}`, depth + 1, succeeded));
        }
    };
    visit(value, "0", 0, true);
    if (rows.length !== 1)
        bridgeFailure("APN_RPC_PROTOCOL", "native_destination_transfer");
    return { transactionHash, from: expected.from, to: expected.recipient, valueAtomic: rows[0].valueAtomic, traceHash: hashObject({ transactionHash, delivery: rows[0] }) };
}
export function parseReceiptLogs(value, hash, block, transactionIndex) {
    if (!Array.isArray(value) || value.length > 256)
        bridgeFailure("APN_RPC_PROTOCOL", "receipt_log_count");
    const indices = new Set();
    return value.map((value) => {
        const l = evmRpcRecord(value), index = evmRpcQuantity(l.logIndex).toString();
        if (indices.has(index) || evmRpcHex(l.transactionHash, 32) !== hash || evmRpcHex(l.blockHash, 32) !== block.hash ||
            evmRpcQuantity(l.blockNumber).toString() !== block.numberAtomic || evmRpcQuantity(l.transactionIndex) !== transactionIndex ||
            l.removed !== undefined && l.removed !== false || !Array.isArray(l.topics) || l.topics.length > 4)
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_log_membership");
        indices.add(index);
        return { address: evmRpcAddress(l.address), topics: l.topics.map((v) => evmRpcHex(v, 32)), data: bridgeHex(l.data, 64 * 1024, undefined, "APN_RPC_PROTOCOL") };
    });
}
//# sourceMappingURL=rpc-proof-codec.js.map