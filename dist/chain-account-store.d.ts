import type { ChainAccount, ChainWalletStoragePort, DirectRailName, RailSignedEffect } from "./direct-rail-ports.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import { SecureStateStore } from "./secure-state-store.js";
/** Call mutations while holding the common profile lock. No private data is projected. */
export declare class ChainAccountStore extends SecureStateStore implements ChainWalletStoragePort {
    private readonly wrappingSecret;
    private initialized;
    constructor(root: string, wrappingSecret: WrappingSecretPort, options?: ConstructorParameters<typeof SecureStateStore>[1]);
    private ready;
    account(profileInput: string, rail: DirectRailName): Promise<ChainAccount | null>;
    ownerBinding(profileInput: string, rail: DirectRailName): Promise<ChainAccount | null>;
    ensureLocal(input: {
        readonly profile: string;
        readonly rail: DirectRailName;
        readonly create: () => Promise<{
            readonly address: string;
            readonly seed: Buffer;
        }>;
    }): Promise<ChainAccount>;
    ensureProvider(input: {
        readonly profile: string;
        readonly rail: DirectRailName;
        readonly provider: "coinbase-awal";
        readonly address: string;
    }): Promise<ChainAccount>;
    withSeed<T>(account: ChainAccount, action: (seed: Buffer) => Promise<T>): Promise<T>;
    effect(account: ChainAccount, operationId: string, fingerprint: string): Promise<RailSignedEffect | null>;
    saveEffect(account: ChainAccount, effect: RailSignedEffect): Promise<void>;
    private requiredSecret;
    private requiredWrapping;
    private decrypt;
    private saveEncrypted;
    private saveAccount;
    private accountPath;
    private walletPath;
}
export declare function sealChainAccount(value: Omit<ChainAccount, "identityHash">): ChainAccount;
export declare function validateChainAccount(value: unknown): ChainAccount;
