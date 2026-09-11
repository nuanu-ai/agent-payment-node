import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessIntent } from "../model.js";
export interface VerifiedMetaMaskOuterTransaction {
    readonly typeAtomic: string;
    readonly from: Address;
    readonly to: Address;
    readonly nonceAtomic: string;
    readonly valueAtomic: string;
    readonly input: Hex;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly authorizationOwner: Address | null;
}
/** Reconstruct types 0..4, authenticate the sender, and bind an optional exact EIP-7702 authorization. */
export declare function verifyMetaMaskOuterTransaction(raw: Record<string, unknown>, expectedHash: Hex, intent: MetaMaskGaslessIntent): Promise<VerifiedMetaMaskOuterTransaction>;
