import type { DirectEffectMaterial, WalletIdentity, X402EffectMaterial } from "./encrypted-wallet-store.js";
import type { Address } from "./model.js";
export declare function publicWalletIdentity(identity: WalletIdentity): {
    readonly profile: string;
    readonly address: Address;
    readonly createdAt: string;
    readonly bindingHash: string;
};
export declare function publicDirectEffect(effect: DirectEffectMaterial): unknown;
export declare function publicX402Effect(effect: X402EffectMaterial): unknown;
