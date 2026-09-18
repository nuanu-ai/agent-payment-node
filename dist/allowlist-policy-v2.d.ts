import { type AllowlistInventory, type CandidateFamily } from "./allowlist-inventory.js";
import { type AllowlistPolicyAdmissionInput } from "./allowlist-policy-overlay.js";
import { type AssetPolicyRegistry } from "./asset-policy-registry.js";
export declare const ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2: "apn.allowlist-policy-overlay.v2";
export declare const ALLOWLIST_POLICY_RECORD_SCHEMA_V2: "apn.allowlist-policy-record.v2";
/** The owner-written file format accepted by `apn allowlist policy stage --file`. */
export declare const ALLOWLIST_POLICY_FILE_SCHEMA: "apn.allowlist-policy-file.v1";
/** One canonical owner account per admitted family. */
export type AllowlistPolicyAccounts = Readonly<Partial<Record<CandidateFamily, string>>>;
export interface AllowlistPolicyFile {
    readonly schemaVersion: typeof ALLOWLIST_POLICY_FILE_SCHEMA;
    readonly overlayVersion: string;
    readonly accounts: AllowlistPolicyAccounts;
    readonly effectiveAt: string;
    readonly expiresAt?: string;
    readonly admissions: readonly AllowlistPolicyAdmissionInput[];
}
export interface AllowlistPolicyOverlayV2Input {
    readonly overlayVersion: string;
    readonly profile: string;
    readonly accounts: AllowlistPolicyAccounts;
    readonly datasetVersion: string;
    readonly datasetSha256: string;
    readonly inventorySha256: string;
    readonly effectiveAt: string;
    readonly expiresAt?: string;
    readonly admissions: readonly AllowlistPolicyAdmissionInput[];
}
export interface AllowlistPolicyOverlayV2 extends AllowlistPolicyOverlayV2Input {
    readonly schemaVersion: typeof ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2;
    readonly profileHash: string;
    readonly overlayDigest: string;
}
export interface AllowlistPolicyRecordV2 {
    readonly schemaVersion: typeof ALLOWLIST_POLICY_RECORD_SCHEMA_V2;
    readonly revision: number;
    readonly status: "staged_unadmitted";
    readonly preparedAt: string;
    readonly overlay: AllowlistPolicyOverlayV2;
    readonly registry: AssetPolicyRegistry;
    readonly recordDigest: string;
}
/**
 * Compile many owner admissions (assets x rails, across EVM, TRON and Solana) into one sealed per-rail-cap registry.
 * Admissions of one asset on several rails merge into one registry row; every cap is copied from the owner input.
 */
export declare function compileAllowlistPolicyOverlayV2(raw: AllowlistPolicyOverlayV2Input, inventory?: AllowlistInventory): {
    readonly overlay: AllowlistPolicyOverlayV2;
    readonly registry: AssetPolicyRegistry;
};
/** Parse the owner-written policy file. Every cap, account, instant and pin must be present; nothing is filled in. */
export declare function parseAllowlistPolicyFile(value: unknown): AllowlistPolicyFile;
export declare function validateAllowlistPolicyRecordV2(value: unknown): AllowlistPolicyRecordV2;
export declare function sealAllowlistPolicyRecordV2(body: Omit<AllowlistPolicyRecordV2, "recordDigest">): AllowlistPolicyRecordV2;
