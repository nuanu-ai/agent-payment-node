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
