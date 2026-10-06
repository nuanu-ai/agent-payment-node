import type { StateStore } from "../state.js";
import type { Address } from "../model.js";
export interface Permit2WalletBinding {
    readonly profile: string;
    readonly profileHash: string;
    readonly account: Address;
    readonly bindingHash: string;
    readonly provider: "local";
    readonly providerRecordDigest: string | null;
    readonly walletChainId: number;
    readonly walletCreatedAt: string;
}
/** Metadata only: never decrypts an envelope or obtains a signing key. */
export declare function permit2WalletBinding(state: StateStore, value: string): Promise<Permit2WalletBinding>;
/** Pure existing metadata predicates; no lock, decrypt or ownership authority. */
export declare function decodePermit2WalletBinding(profile: string, profileHash: string, artifacts: Awaited<ReturnType<StateStore["loadWalletArtifacts"]>>, provider: Awaited<ReturnType<StateStore["loadProviderProfile"]>>): Permit2WalletBinding;
