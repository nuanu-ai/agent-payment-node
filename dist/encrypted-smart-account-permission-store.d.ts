import type { WrappingSecretPort } from "./macos-keychain.js";
import { type SmartAccountPermissionRecord } from "./metamask-smart-account-record.js";
import type { StateStore } from "./state.js";
export interface SmartAccountPermissionStorePort {
    load(profileHash: string): Promise<SmartAccountPermissionRecord | null>;
    save(record: SmartAccountPermissionRecord): Promise<void>;
    remove(profileHash: string): Promise<void>;
    compareAndSet(expected: SmartAccountPermissionRecord, replacement: SmartAccountPermissionRecord | null): Promise<boolean>;
}
export declare class EncryptedSmartAccountPermissionStore implements SmartAccountPermissionStorePort {
    private readonly state;
    private readonly wrappingSecret;
    private readonly files;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort);
    load(profileHash: string): Promise<SmartAccountPermissionRecord | null>;
    /** Scan only while the caller holds evmAddressLock(address). Every entry is authenticated. */
    listAll(): Promise<readonly SmartAccountPermissionRecord[]>;
    save(record: SmartAccountPermissionRecord): Promise<void>;
    private writeProtected;
    remove(profileHash: string): Promise<void>;
    compareAndSet(expected: SmartAccountPermissionRecord, replacement: SmartAccountPermissionRecord | null): Promise<boolean>;
}
