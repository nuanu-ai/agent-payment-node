import type { CommandOutcome } from "../../commands.js";
import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type ProviderX402OperationRecord } from "../../provider-x402-model.js";
import { ProviderX402Repository } from "../../provider-x402-repository.js";
import { StateStore } from "../../state.js";
import { type X402OperationRecord, type X402SettlementWaitProjection } from "../../x402-state-integrity.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/** Local and provider-atomic purchases share one path, told apart by schema (state.ts and provider-x402-repository.ts). */
export type X402StoredOperation = {
    readonly strategy: "local";
    readonly record: X402OperationRecord;
} | {
    readonly strategy: "provider_atomic";
    readonly record: ProviderX402OperationRecord;
};
export declare function x402Domains(operation: X402StoredOperation): readonly MoneyConflictDomain[];
export declare function x402Terminal(operation: {
    readonly strategy: X402StoredOperation["strategy"];
    readonly record: {
        readonly state: string;
    };
}): boolean;
export declare const x402Adapter: OperationFamilyAdapter<X402StoredOperation>;
export interface X402OutcomeOptions {
    readonly exposeSellerResult: boolean;
    readonly exposeTerminalReceipt: boolean;
    readonly settlementWait?: X402SettlementWaitProjection;
}
/** The status/resume outcome of a saved purchase, with its linked seller result and terminal receipt. */
export declare function x402StoredOutcome(state: StateStore, providerReceipts: Pick<ProviderX402Repository, "loadReceipt">, found: X402StoredOperation, options: X402OutcomeOptions): Promise<CommandOutcome>;
export declare function x402StoredReceiptOutcome(state: StateStore, providerReceipts: Pick<ProviderX402Repository, "loadReceipt">, found: X402StoredOperation): Promise<CommandOutcome>;
