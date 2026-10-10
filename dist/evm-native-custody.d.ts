import type { WalletIdentity } from "./encrypted-wallet-store.js";
import type { Address } from "./model.js";
import type { StateStore } from "./state.js";
/** Public StateStore identity, deliberately distinct from the allowlist profile namespace. */
export interface EvmNativeCustody {
    readonly schemaVersion: "apn.evm-native-custody.v1";
    readonly profileHash: string;
    readonly walletAddress: Address;
    readonly walletBindingHash: string;
    readonly walletCreatedAt: string;
    readonly providerId: "local";
    readonly providerAccountBindingHash: string;
    readonly providerCapabilityHash: string;
    readonly providerRevision: number;
}
export declare function validateEvmNativeCustody(value: unknown): EvmNativeCustody;
export declare function evmNativeCustody(state: StateStore, profileInput: string): Promise<EvmNativeCustody>;
export declare function assertEvmNativeCustody(state: StateStore, profile: string, expected: EvmNativeCustody, identity?: WalletIdentity): Promise<void>;
