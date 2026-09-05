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
    save(record: SmartAccountPermissionRecord): Promise<void>;
    remove(profileHash: string): Promise<void>;
    compareAndSet(expected: SmartAccountPermissionRecord, replacement: SmartAccountPermissionRecord | null): Promise<boolean>;
}
