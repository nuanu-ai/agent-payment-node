import type { Address, Hex } from "../../model.js";
import type { SmartAccountGaslessIntent } from "../model.js";
export interface VerifiedSmartAccountOuterTransaction {
    readonly typeAtomic: string;
    readonly from: Address;
    readonly to: Address;
    readonly nonceAtomic: string;
    readonly valueAtomic: string;
    readonly input: Hex;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly authorizationOwners: readonly Address[];
}
/** Reconstruct and authenticate every supported canonical signed envelope, including every type-4 authorization. */
export declare function verifySmartAccountOuterTransaction(raw: Record<string, unknown>, expectedHash: Hex, intent: SmartAccountGaslessIntent): Promise<VerifiedSmartAccountOuterTransaction>;
