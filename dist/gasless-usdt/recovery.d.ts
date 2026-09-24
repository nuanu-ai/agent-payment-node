import type { Hex } from "../model.js";
import { type UsdtBoundOperation } from "./bound-operation.js";
import { UsdtExecutionJournal, type UsdtExecutionRecord } from "./execution-journal.js";
import { type UsdtChainReceipt } from "./receipt.js";
/** Untrusted bundler locator. The chain receipt and its EntryPoint event remain the outcome authority. */
export interface UsdtUserOperationReceipt {
    readonly userOpHash: Hex;
    readonly sender: string;
    readonly entryPoint: string;
    readonly paymaster: string;
    readonly success: boolean;
    readonly transactionHash: Hex;
}
export interface UsdtRecoveryPort {
    userOperationReceipt(hash: Hex): Promise<UsdtUserOperationReceipt | null>;
    /** Returns a receipt only when its block is canonical and at or below Ethereum's finalized head. */
    canonicalFinalizedReceipt(transactionHash: Hex): Promise<UsdtChainReceipt | null>;
}
/** One bounded observation pass. It never signs, sends or retries a provider read. */
export declare class UsdtRecoveryService {
    private readonly journal;
    private readonly port;
    private readonly now;
    constructor(journal: UsdtExecutionJournal, port: UsdtRecoveryPort, now: () => Date);
    observe(value: UsdtBoundOperation): Promise<UsdtExecutionRecord>;
}
