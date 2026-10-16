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
/**
 * The bundler's outer transaction as the RPC reports it, bound to the receipt by hash and canonical block membership.
 * Its signature is not reconstructed: the RPC is the trust root for chain data and could serve any self-consistent
 * signed transaction, so recovery proves nothing more. The effect is proven by the receipt logs; this projection only
 * fixes the EntryPoint target, the zero value and a sender other than the owner for the transaction proof hash.
 */
export declare function gaslessOuterTransaction(raw: Record<string, unknown>, chainId: GaslessChainId, expectedHash: Hex): GaslessOuterTransaction;
