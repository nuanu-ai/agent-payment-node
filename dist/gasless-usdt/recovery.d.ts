import type { Address, Hex } from "../model.js";
import type { UsdtAnyBoundOperation as UsdtBoundOperation } from "./bound-operation.js";
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
/** Canonical EntryPoint `UserOperationEvent` scan for one hash, sender and paymaster through Ethereum's finalized head. */
export interface UsdtUserOperationScanInput {
    readonly userOpHash: Hex;
    readonly sender: Address;
    /** The prepared safe block: the operation was signed later, so no earlier block can include it. */
    readonly fromBlock: bigint;
    readonly fromBlockHash: Hex;
    /** Signed paymaster `validUntil`; EntryPoint refuses the operation in any block with a later timestamp. */
    readonly validUntil: bigint;
}
export type UsdtUserOperationScan = {
    readonly status: "found";
    readonly transactionHash: Hex;
}
/**
 * `final` means the scan covered every block from `fromBlock` through a finalized block whose timestamp is after
 * `validUntil`, so the exact operation can never be included.
 */
 | {
    readonly status: "not_found";
    readonly final: boolean;
    readonly finalizedBlock: bigint;
    readonly endBlock: bigint;
    readonly endBlockHash: Hex | null;
};
export interface UsdtRecoveryPort {
    userOperationReceipt(hash: Hex): Promise<UsdtUserOperationReceipt | null>;
    /** Returns a receipt only when its block is canonical and at or below Ethereum's finalized head. */
    canonicalFinalizedReceipt(transactionHash: Hex): Promise<UsdtChainReceipt | null>;
    scanUserOperation(input: UsdtUserOperationScanInput): Promise<UsdtUserOperationScan>;
}
/** One bounded observation pass. It never signs, sends or retries a provider read. */
export declare class UsdtRecoveryService {
    private readonly journal;
    private readonly port;
    private readonly now;
    constructor(journal: UsdtExecutionJournal, port: UsdtRecoveryPort, now: () => Date);
    observe(value: UsdtBoundOperation): Promise<UsdtExecutionRecord>;
    /** The chain decides: exactly one successful event with the exact debits settles; one failed event is a confirmed revert. */
    private proven;
}
