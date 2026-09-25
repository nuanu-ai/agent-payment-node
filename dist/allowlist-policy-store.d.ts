import { type AllowlistPolicyRecord, type PrepareAllowlistPolicyInput } from "./allowlist-policy-overlay.js";
import { type AllowlistPolicyAccounts, type AllowlistPolicyFile, type AllowlistPolicyRecordV2 } from "./allowlist-policy-v2.js";
import { type AssetPolicyRegistry } from "./asset-policy-registry.js";
import { SecureStateStore } from "./secure-state-store.js";
export declare const ALLOWLIST_POLICY_ACTIVATION_SCHEMA: "apn.allowlist-policy-activation.v1";
export type StagedAllowlistPolicyRecord = AllowlistPolicyRecord | AllowlistPolicyRecordV2;
/** One sealed, hash-chained owner decision. The newest entry is the profile's current activation state. */
export interface AllowlistPolicyActivationEntry {
    readonly schemaVersion: typeof ALLOWLIST_POLICY_ACTIVATION_SCHEMA;
    readonly profileHash: string;
    readonly sequence: number;
    readonly previousEntryDigest: string | null;
    readonly status: "active" | "revoked";
    readonly revision: number;
    readonly stagedRecordDigest: string;
    readonly policyDigest: string;
    /** The exact ACTIVE registry; present only on an active entry. */
    readonly registry?: AssetPolicyRegistry;
    readonly approvalFingerprint: string;
    readonly decidedAt: string;
    readonly entryDigest: string;
}
export type AllowlistPolicyDecision = Pick<AllowlistPolicyActivationEntry, "status" | "revision" | "stagedRecordDigest" | "policyDigest" | "registry" | "approvalFingerprint" | "decidedAt">;
/** One authenticated read of a profile: every staged revision and the complete activation chain. */
export interface AllowlistPolicyState {
    readonly profile: string;
    readonly profileHash: string;
    readonly records: readonly StagedAllowlistPolicyRecord[];
    readonly entries: readonly AllowlistPolicyActivationEntry[];
}
export interface StageAllowlistPolicyInput {
    readonly profile: string;
    readonly policy: AllowlistPolicyFile;
    readonly expectedRevision?: number;
    readonly now: Date;
}
export declare class AllowlistPolicyStore extends SecureStateStore {
    private initialized;
    /** Version 1 single-admission staging, retained for the flag-based `prepare` command. */
    prepare(input: PrepareAllowlistPolicyInput): Promise<AllowlistPolicyRecord>;
    /** Stage one multi-admission, multi-family revision. Staging never grants execution authority. */
    stage(input: StageAllowlistPolicyInput): Promise<AllowlistPolicyRecordV2>;
    /** The latest staged revision, authenticated. */
    status(profile: string): Promise<StagedAllowlistPolicyRecord | null>;
    read(profile: string): Promise<AllowlistPolicyState>;
    /** Caller must already hold profile:<allowlistProfileHash(profile)>; used for an atomic policy-bound transition. */
    readUnderProfileLock(profile: string): Promise<AllowlistPolicyState>;
    /** Append one decision only if the chain head still equals the head the human approved against. */
    appendDecision(profile: string, expectedHeadDigest: string | null, decision: AllowlistPolicyDecision): Promise<AllowlistPolicyActivationEntry>;
    private writeRevision;
    private load;
    private ready;
}
export declare function validateStagedAllowlistPolicyRecord(value: unknown): StagedAllowlistPolicyRecord;
export declare function stagedRecordAccounts(record: StagedAllowlistPolicyRecord): AllowlistPolicyAccounts;
export declare function validateActivationEntry(value: unknown): AllowlistPolicyActivationEntry;
