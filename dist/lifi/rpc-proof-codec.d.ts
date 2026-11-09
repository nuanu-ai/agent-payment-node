import type { Address, Hex } from "../model.js";
import type { BridgeBlock, BridgeLog } from "./model.js";
/**
 * The one native value CALL from the pinned payer to the recipient in a bounded callTracer tree. It is the delivery proof,
 * so it must have taken effect: the frame and every frame above it succeeded. A reverted ancestor undoes a child that
 * callTracer still reports without an error of its own. The trace is the only delivery proof, so its root must be the
 * verified transaction itself: a successful CALL with the transaction's sender, target, value and calldata. A trace of any
 * other transaction (a stale or mixed-up RPC answer) is refused. callTracer reports no hash: the trace is requested by the
 * verified one.
 */
export declare function exactNativeTransfer(value: unknown, transactionHash: Hex, expected: Readonly<{
    recipient: Address;
    from: Address;
    amountAtomic?: string;
    minimumAmountAtomic?: string;
}>, transaction: Readonly<{
    sender: Address;
    target: Address;
    valueAtomic: string;
    calldata: Hex;
}>): {
    transactionHash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}`;
    valueAtomic: string;
    traceHash: string;
};
export declare function parseReceiptLogs(value: unknown, hash: Hex, block: BridgeBlock, transactionIndex: bigint): readonly BridgeLog[];
