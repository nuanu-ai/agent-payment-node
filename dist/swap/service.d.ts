import { type AssetPolicyRegistry } from "../asset-policy-registry.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { type SwapQuoteInput } from "./quote.js";
import { type SwapOperationRecord, type SwapReceiptProof } from "./model.js";
import { SwapOperationRepository } from "./repository.js";
export declare class GuardedSwapService {
    readonly operations: SwapOperationRepository;
    readonly usage: AssetUsageLedger;
    constructor(operations: SwapOperationRepository, usage: AssetUsageLedger);
    prepare(input: {
        readonly quote: SwapQuoteInput;
        readonly assetPolicy: unknown;
        readonly protocolRegistry: unknown;
        readonly idempotencyKey: string;
        readonly approvalCapAtomic: string;
        readonly now: Date;
    }): Promise<SwapOperationRecord>;
    reserve(operation: SwapOperationRecord, policy: AssetPolicyRegistry, now: Date): Promise<SwapOperationRecord>;
    markSubmitting(operation: SwapOperationRecord, now: Date): Promise<SwapOperationRecord>;
    recordPossibleSend(operation: SwapOperationRecord, state: "submitted" | "unknown_finality", now: Date, receiptProof?: SwapReceiptProof): Promise<SwapOperationRecord>;
    finalize(operation: SwapOperationRecord, now: Date, receiptProof: SwapReceiptProof): Promise<SwapOperationRecord>;
    failBeforeEffect(operation: SwapOperationRecord, now: Date, failureProofHash: string): Promise<SwapOperationRecord>;
    resumeDirective(operation: SwapOperationRecord): "prepare_or_approve" | "observe_only" | "terminal";
}
