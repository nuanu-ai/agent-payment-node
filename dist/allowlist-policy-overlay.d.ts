import { type AllowlistInventory, type CandidateKind, type CandidateRail } from "./allowlist-inventory.js";
import { type AssetPolicyRegistry } from "./asset-policy-registry.js";
import { type SwapMechanismPin } from "./swap/pin.js";
export declare const ALLOWLIST_POLICY_OVERLAY_SCHEMA: "apn.allowlist-policy-overlay.v1";
export declare const ALLOWLIST_POLICY_RECORD_SCHEMA: "apn.allowlist-policy-record.v1";
export interface AllowlistMechanismPin {
    readonly provider: string;
    readonly reference: string;
}
export type AllowlistAdmissionMechanismPin = AllowlistMechanismPin | SwapMechanismPin;
export interface AllowlistPolicyAdmissionInput {
    readonly chain: string;
    readonly kind: CandidateKind;
    readonly identifier?: string;
    readonly rail: CandidateRail;
    readonly maximumPerTransferAtomic?: string;
    readonly dailyLimitAtomic: string;
    readonly mechanism?: AllowlistAdmissionMechanismPin;
    /** Optional exact recipient for Ethereum or Base local gasless transfers. */
    readonly recipient?: string;
    /** Bridge only: exact alternative pins, each with its own per-transfer ceiling. */
    readonly mechanisms?: readonly (AllowlistMechanismPin & {
        readonly maximumPerTransferAtomic: string;
    })[];
}
export interface AllowlistPolicyOverlayInput {
    readonly overlayVersion: string;
    readonly profile: string;
    readonly account: string;
    readonly datasetVersion: string;
    readonly datasetSha256: string;
    readonly inventorySha256: string;
    readonly effectiveAt: string;
    readonly expiresAt?: string;
    readonly admissions: readonly AllowlistPolicyAdmissionInput[];
}
export interface AllowlistPolicyOverlay extends AllowlistPolicyOverlayInput {
    readonly schemaVersion: typeof ALLOWLIST_POLICY_OVERLAY_SCHEMA;
    readonly profileHash: string;
    readonly overlayDigest: string;
}
export interface AllowlistPolicyRecord {
    readonly schemaVersion: typeof ALLOWLIST_POLICY_RECORD_SCHEMA;
    readonly revision: number;
    readonly status: "staged_unadmitted";
    readonly preparedAt: string;
    readonly overlay: AllowlistPolicyOverlay;
    readonly registry: AssetPolicyRegistry;
    readonly recordDigest: string;
}
export interface PrepareAllowlistPolicyInput extends AllowlistPolicyOverlayInput {
    readonly expectedRevision?: number;
    readonly now: Date;
}
/** Storage identity shared by every overlay and activation schema for one policy profile. */
export declare function allowlistProfileHash(profile: string): string;
export declare function compileAllowlistPolicyOverlay(raw: AllowlistPolicyOverlayInput, inventory?: AllowlistInventory): {
    readonly overlay: AllowlistPolicyOverlay;
    readonly registry: AssetPolicyRegistry;
};
export declare function validateAllowlistPolicyRecord(value: unknown): AllowlistPolicyRecord;
/** One owner-supplied admission row: exact identity, one rail, positive owner caps and the rail's pinned mechanism. */
export declare function validateAllowlistAdmission(value: unknown): AllowlistPolicyAdmissionInput;
export declare function canonicalAllowlistAccount(family: string, value: unknown): string;
export declare function isoInstant(value: string): boolean;
