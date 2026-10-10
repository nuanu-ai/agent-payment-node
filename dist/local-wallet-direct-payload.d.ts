import type { Hex } from "./model.js";
import type { TransferApprovalIntent } from "./tty-approval.js";
export interface DirectIntent extends TransferApprovalIntent {
    readonly transactionData: Hex;
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
}
export declare function parseDirectIntent(payload: Readonly<Record<string, unknown>>): DirectIntent;
export declare function parseDirectRecovery(payload: Readonly<Record<string, unknown>>): {
    readonly profile: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly expectedTransactionHash: Hex;
    readonly expectedRawTransactionHash: Hex;
} | {
    readonly profile: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly expectedPayloadHash: string;
};
