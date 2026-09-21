import type { Address, Hex } from "../model.js";
import type { BridgeBlock, BridgeLog } from "./model.js";
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
