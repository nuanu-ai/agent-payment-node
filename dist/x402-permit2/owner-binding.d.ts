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
