import type { WrappingSecretPort } from "./macos-keychain.js";
import type { Address, Hex } from "./model.js";
import type { StateStore } from "./state.js";
declare const RECORD_VERSION: "apn.metamask-smart-account-x402-material.v1";
export interface SmartAccountX402MaterialRecord {
    readonly schema_version: typeof RECORD_VERSION;
    readonly operation_id: string;
    readonly profile_hash: string;
    readonly fingerprint: string;
    readonly request_hash: string;
    readonly offer_hash: string;
    readonly root_grant_fingerprint: string;
    readonly child_hash: string;
    readonly permission_context_hash: string;
    readonly payment_payload_hash: string;
    readonly payment_header_hash: string;
    readonly material_identity_hash: string;
    readonly delegation_manager: Address;
    readonly delegator: Address;
    readonly child_permission_context: Hex;
    readonly payment_payload_canonical_json: string;
    readonly payment_header: string;
    readonly effective_expiry_unix: string;
    readonly phase: "sealed" | "exposed";
    readonly sealed_at: string;
    readonly updated_at: string;
    readonly integrity_hash: string;
}
export type UnsealedSmartAccountX402Material = Omit<SmartAccountX402MaterialRecord, "material_identity_hash" | "integrity_hash">;
export interface SmartAccountX402MaterialStorePort {
    load(operationId: string): Promise<SmartAccountX402MaterialRecord | null>;
    seal(record: UnsealedSmartAccountX402Material): Promise<SmartAccountX402MaterialRecord>;
    markExposed(operationId: string, updatedAt: string): Promise<SmartAccountX402MaterialRecord>;
}
export declare class EncryptedSmartAccountX402MaterialStore implements SmartAccountX402MaterialStorePort {
    private readonly wrappingSecret;
    private readonly files;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort);
    load(operationId: string): Promise<SmartAccountX402MaterialRecord | null>;
    seal(record: UnsealedSmartAccountX402Material): Promise<SmartAccountX402MaterialRecord>;
    markExposed(operationId: string, updatedAt: string): Promise<SmartAccountX402MaterialRecord>;
    private write;
}
export {};
