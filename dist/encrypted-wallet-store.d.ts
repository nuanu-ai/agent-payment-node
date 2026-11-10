import { CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
import type { Address, Hex } from "./model.js";
import type { StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
declare const SECRET_VERSION = "apn.wallet-secret.v1";
export interface WalletIdentity {
    readonly profile: string;
    readonly address: Address;
    readonly chainId: typeof CHAIN_ID;
    readonly createdAt: string;
    readonly bindingHash: string;
}
export interface DirectEffectMaterial {
    readonly payloadHash: string;
    readonly transactionHash: Hex;
    readonly rawTransaction: Hex;
    readonly rawTransactionHash: Hex;
    readonly primaryProviderId?: string | null;
    /** The generic direct-transfer operation that owns this slot; the slot is released once it is terminal. */
    readonly operationId?: string;
}
export interface X402EffectMaterial {
    readonly createPayloadHash: string;
    readonly recoveryBindingHash: string;
    readonly authorization: Readonly<Record<string, string>>;
    readonly signature: Hex;
    readonly signatureHash: string;
    /** Permit2 witness transfers only: the seller-sponsored exact-amount EIP-2612 permit to Permit2. */
    readonly eip2612Signature?: Hex;
}
export interface WalletSecretState {
    version: typeof SECRET_VERSION;
    privateKey: Hex;
    directEffects: Record<string, DirectEffectMaterial>;
    x402Effects: Record<string, X402EffectMaterial>;
}
/** One kernel-backed critical section owns every encrypted local-wallet mutation for a profile. */
export declare function walletCustodyLock(state: StateStore, profileInput: string): string;
export declare class EncryptedWalletStore {
    private readonly state;
    private readonly wrappingSecret;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort);
    describe(profileInput: string, beforeDecrypt?: () => void, beforeKeyLoad?: (identity: WalletIdentity) => Promise<void>): Promise<{
        readonly identity: WalletIdentity;
        readonly secret: WalletSecretState;
    } | null>;
    ensure(profileInput: string): Promise<{
        readonly identity: WalletIdentity;
        readonly secret: WalletSecretState;
    }>;
    importNew(profileInput: string, privateKeyInput: string, expectedAddress: string): Promise<WalletIdentity>;
    save(identity: WalletIdentity, secret: WalletSecretState, wrappingInput?: Buffer, createOnly?: boolean): Promise<void>;
    clear(secret: WalletSecretState): void;
    /** The wrapping secret is still in the Keychain: it is loaded only to be zeroed at once, and nothing is decrypted. */
    assertWrappingSecretPresent(): Promise<void>;
    private requiredWrappingSecret;
}
/**
 * A local wallet whose login-Keychain wrapping secret is gone. Wallet status, ensure and doctor refuse it with this
 * reason instead of calling it ready; nothing replaces the secret, and only that Keychain item unwraps the wallet.
 */
export declare function walletWrappingSecretMissing(): ApnError;
/** Validate public envelope identity without loading or exposing the signing key. */
export declare function walletEnvelopeIdentity(value: unknown, profile: string): WalletIdentity;
export {};
