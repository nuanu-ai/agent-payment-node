import type { Address, Hex } from "../model.js";
import type { BridgeBlock, BridgeLog } from "./model.js";
/**
 * The one native value CALL from the pinned payer to the recipient in a bounded callTracer tree. It is the delivery proof,
 * so it must have taken effect: the frame and every frame above it succeeded. A reverted ancestor undoes a child that
 * callTracer still reports without an error of its own.
 */
export declare function exactNativeTransfer(value: unknown, transactionHash: Hex, expected: Readonly<{
    recipient: Address;
    from: Address;
    amountAtomic?: string;
    minimumAmountAtomic?: string;
}>): {
    transactionHash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}`;
    valueAtomic: string;
    traceHash: string;
};
export declare function parseReceiptLogs(value: unknown, hash: Hex, block: BridgeBlock, transactionIndex: bigint): readonly BridgeLog[];
