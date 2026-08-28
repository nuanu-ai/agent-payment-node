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
    save(identity: WalletIdentity, secret: WalletSecretState, wrappingInput?: Buffer): Promise<void>;
    clear(secret: WalletSecretState): void;
    private requiredWrappingSecret;
}
export {};
