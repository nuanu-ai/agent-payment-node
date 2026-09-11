import type { WrappingSecretPort } from "./macos-keychain.js";
import type { Address, Hex } from "./model.js";
import type { StateStore } from "./state.js";
import type { SmartAccountGaslessMaterialHashes } from "./smart-account-gasless/model.js";
declare const RECORD_VERSION: "apn.smart-account-gasless-material.v1";
export interface SmartAccountGaslessMaterialRecord extends SmartAccountGaslessMaterialHashes {
    readonly schema_version: typeof RECORD_VERSION;
    readonly operation_id: string;
    readonly profile_hash: string;
    readonly fingerprint: string;
    readonly request_hash: string;
    readonly root_grant_fingerprint: string;
    readonly delegation_manager: Address;
    readonly delegator: Address;
    readonly root_context: Hex;
    readonly encoded_child: Hex;
    readonly permission_context: Hex;
    readonly payment_payload_canonical_json: string;
    readonly phase: "sealed" | "exposed";
    readonly sealed_at: string;
    readonly updated_at: string;
    readonly integrity_hash: string;
}
export type UnsealedSmartAccountGaslessMaterial = Omit<SmartAccountGaslessMaterialRecord, "integrity_hash">;
export interface SmartAccountGaslessMaterialStorePort {
    load(operationId: string): Promise<SmartAccountGaslessMaterialRecord | null>;
    seal(record: UnsealedSmartAccountGaslessMaterial): Promise<SmartAccountGaslessMaterialRecord>;
    markExposed(operationId: string, updatedAt: string): Promise<SmartAccountGaslessMaterialRecord>;
}
export declare class EncryptedSmartAccountGaslessMaterialStore implements SmartAccountGaslessMaterialStorePort {
    private readonly wrapping;
    private readonly files;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    load(operationId: string): Promise<SmartAccountGaslessMaterialRecord | null>;
    seal(record: UnsealedSmartAccountGaslessMaterial): Promise<SmartAccountGaslessMaterialRecord>;
    markExposed(operationId: string, updatedAt: string): Promise<SmartAccountGaslessMaterialRecord>;
    private write;
}
export {};
