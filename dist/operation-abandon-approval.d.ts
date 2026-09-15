import { type TtyTransferApprovalOptions } from "./tty-approval.js";
export interface OperationAbandonIntent {
    readonly operationId: string;
    readonly fingerprint: string;
    readonly profile: string;
    readonly providerId: string;
    readonly walletAddress: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly amountDecimal: string;
    readonly chainLabel: string;
    readonly assetLabel: string;
    readonly unit: string;
    readonly outcomeNote: string;
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
