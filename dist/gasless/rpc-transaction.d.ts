import type { Address, Hex } from "../model.js";
import type { GaslessChainId } from "./model.js";
export interface GaslessOuterTransaction {
    readonly typeAtomic: string;
    readonly from: Address;
    readonly to: Address;
    readonly nonceAtomic: string;
    readonly valueAtomic: string;
    readonly dataHash: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
}
/** Reconstruct and authenticate a signed outer EVM transaction of type 0 through 4. */
export declare function verifyGaslessOuterTransaction(raw: Record<string, unknown>, chainId: GaslessChainId, expectedHash: Hex): Promise<GaslessOuterTransaction>;
