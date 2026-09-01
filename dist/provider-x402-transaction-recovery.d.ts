import type { CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
type RecoveryRequest = Extract<CommandRequest, {
    readonly command: "operation.recover-transaction-settlement";
}>;
export interface ProviderX402RecoveryProjection {
    readonly operation: {
        readonly operationId: string;
        readonly state: "failed_settled_without_result";
        readonly reason: "seller_result_missing";
        readonly proofClass: "confirmed_exact_transaction_settlement_without_seller_result";
        readonly transactionHash: `0x${string}`;
        readonly terminal: true;
        readonly createdAt: string;
        readonly updatedAt: string;
        readonly nextActions: readonly ["receipt.get"];
    };
    readonly receipt: {
        readonly operationId: string;
        readonly terminalState: "failed_settled_without_result";
        readonly reason: "seller_result_missing";
        readonly proofClass: "confirmed_exact_transaction_settlement_without_seller_result";
        readonly transactionHash: `0x${string}`;
        readonly receiptIntegrity: string;
        readonly createdAt: string;
    };
}
export declare class ProviderX402TransactionRecoveryService {
    private readonly context;
    private readonly repository;
    constructor(context: RuntimeContext);
    recover(request: RecoveryRequest): Promise<ProviderX402RecoveryProjection>;
    private evidence;
    private requiredOperation;
    private assertCompatible;
    private projectCommitted;
    private persistTransition;
}
export {};
