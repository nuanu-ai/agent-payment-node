import type { CommandOutcome } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
import { type X402SettlementWaitProjection, type X402OperationRecord } from "./x402-state-integrity.js";
export type StoredMoneyOperation = {
    readonly kind: "direct_transfer";
    readonly record: OperationRecord;
} | {
    readonly kind: "x402_fetch";
    readonly record: X402OperationRecord;
};
export declare class OperationService {
    private readonly state;
    constructor(state: StateStore);
    resolvePrepare(input: {
        readonly kind: StoredMoneyOperation["kind"];
        readonly profileHash: string;
        readonly operationId: string;
        readonly idempotencyHash: string;
        readonly requestHash: string;
    }): Promise<StoredMoneyOperation | null>;
    assertProfileAvailable(profileHash: string): Promise<void>;
    required(operationId: string): Promise<StoredMoneyOperation>;
    status(operationId: string): Promise<unknown>;
    x402Outcome(operationId: string, options: {
        readonly exposeSellerResult: boolean;
        readonly exposeTerminalReceipt: boolean;
        readonly settlementWait?: X402SettlementWaitProjection;
    }): Promise<CommandOutcome>;
    x402ReceiptOutcome(operationId: string): Promise<CommandOutcome>;
}
