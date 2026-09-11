import type { Address } from "./model.js";
import { type TtyTransferApprovalOptions } from "./tty-approval.js";
export interface OperationAbandonIntent {
    readonly operationId: string;
    readonly fingerprint: string;
    readonly profile: string;
    readonly providerId: string;
    readonly walletAddress: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly amountDecimal: string;
}
export interface OperationAbandonApprovalPort {
    approve(intent: OperationAbandonIntent): Promise<void>;
}
export declare class TtyOperationAbandonApproval implements OperationAbandonApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    approve(intent: OperationAbandonIntent): Promise<void>;
}
export declare function operationAbandonPhrase(fingerprint: string): string;
