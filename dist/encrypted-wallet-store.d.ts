import { CHAIN_ID } from "./constants.js";
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
}
export interface X402EffectMaterial {
    readonly createPayloadHash: string;
    readonly recoveryBindingHash: string;
    readonly authorization: Readonly<Record<string, string>>;
    readonly signature: Hex;
    readonly signatureHash: string;
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
    describe(profileInput: string): Promise<{
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
    private requiredWrappingSecret;
}
/** Validate public envelope identity without loading or exposing the signing key. */
export declare function walletEnvelopeIdentity(value: unknown, profile: string): WalletIdentity;
export {};
