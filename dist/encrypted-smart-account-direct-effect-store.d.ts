import type { Economics, Address, Hex } from "./model.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { StateStore } from "./state.js";
declare const RECORD_VERSION: "apn.metamask-smart-account-direct-effect.v1";
export type SmartAccountDirectEffectPhase = "sealed" | "submission_pending" | "submission_ambiguous" | "submitted";
export interface SmartAccountDirectEffectRecord {
    readonly schema_version: typeof RECORD_VERSION;
    readonly operation_id: string;
    readonly profile_hash: string;
    readonly intent_fingerprint: string;
    readonly root_grant_fingerprint: string;
    readonly child_fingerprint: string;
    readonly owner_address: Address;
    readonly session_address: Address;
    readonly recipient: Address;
    readonly amount_atomic: string;
    readonly delegation_manager: Address;
    readonly child_context: Hex;
    readonly redemption_calldata: Hex;
    readonly raw_transaction: Hex;
    readonly transaction_hash: Hex;
    readonly nonce_atomic: string;
    readonly economics: Economics;
    readonly phase: SmartAccountDirectEffectPhase;
    readonly submission_attempts: number;
    readonly sealed_at: string;
    readonly updated_at: string;
    readonly integrity_hash: string;
}
export type UnsealedSmartAccountDirectEffect = Omit<SmartAccountDirectEffectRecord, "integrity_hash">;
export interface SmartAccountDirectEffectStorePort {
    load(operationId: string): Promise<SmartAccountDirectEffectRecord | null>;
    seal(record: UnsealedSmartAccountDirectEffect): Promise<SmartAccountDirectEffectRecord>;
    transition(operationId: string, phase: SmartAccountDirectEffectPhase, submissionAttempts: number, updatedAt: string): Promise<SmartAccountDirectEffectRecord>;
}
export declare class EncryptedSmartAccountDirectEffectStore implements SmartAccountDirectEffectStorePort {
    private readonly wrappingSecret;
    private readonly files;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort);
    load(operationId: string): Promise<SmartAccountDirectEffectRecord | null>;
    seal(record: UnsealedSmartAccountDirectEffect): Promise<SmartAccountDirectEffectRecord>;
    transition(operationId: string, phase: SmartAccountDirectEffectPhase, submissionAttempts: number, updatedAt: string): Promise<SmartAccountDirectEffectRecord>;
    private write;
}
export {};
