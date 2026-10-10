import type { CommandOutcome } from "./commands.js";
import { type ProviderX402OperationRecord, type ProviderX402ReceiptRecord } from "./provider-x402-model.js";
import { type X402OperationRecord, type X402ResultRecord, type X402ReceiptRecord, type X402SettlementWaitProjection } from "./x402-state-integrity.js";
import { projectPublicX402Receipt } from "./x402-public-artifacts.js";
interface X402OutcomeOptions {
    readonly exposeSellerResult: boolean;
    readonly exposeTerminalReceipt: boolean;
    readonly settlementWait?: X402SettlementWaitProjection;
}
/** Pure projections: durable reads and admission remain in OperationService. */
export declare function providerX402Outcome(operation: ProviderX402OperationRecord, receipt: ProviderX402ReceiptRecord | null, options: X402OutcomeOptions): CommandOutcome;
export declare function localX402Outcome(operation: X402OperationRecord, result: X402ResultRecord | null, receipt: X402ReceiptRecord | null, options: X402OutcomeOptions): CommandOutcome;
export declare function x402ReceiptOutcome(input: Parameters<typeof projectPublicX402Receipt>[0]): CommandOutcome;
export {};
