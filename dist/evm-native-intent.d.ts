import { type EvmDirectBinding } from "./evm-direct.js";
import type { Hex } from "./model.js";
import type { TransferApprovalIntent } from "./tty-approval.js";
export interface EvmNativeIntent extends TransferApprovalIntent {
    readonly evm: EvmDirectBinding;
    readonly transactionData: Hex;
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
}
export declare function parseEvmNativeIntent(payload: Readonly<Record<string, unknown>>): EvmNativeIntent;
/** Detach caller data before an async approval can change any nested financial field. */
export declare function snapshotEvmNativePayload(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
