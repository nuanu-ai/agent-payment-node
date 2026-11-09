import { type AllowlistPolicyRecordV2 } from "./allowlist-policy-v2.js";
/** The variable naming the one owner policy that every profile of a server shares. There is no default path. */
export declare const GLOBAL_POLICY_FILE_ENV = "APN_GLOBAL_POLICY_FILE";
export declare const GLOBAL_POLICY_FILE_SCHEMA: "apn.global-allowlist-policy.v1";
/**
 * The global policy file: an ordinary owner allowlist file without `accounts`. Each profile is bound to its own
 * public addresses when the policy is read, so one file configured once admits the same assets, rails, mechanisms,
 * caps and recipient pins for every profile, each profile keeping its own daily caps.
 */
export interface GlobalAllowlistPolicyFile {
    readonly schemaVersion: typeof GLOBAL_POLICY_FILE_SCHEMA;
    readonly overlayVersion: string;
    readonly effectiveAt: string;
    readonly expiresAt?: string;
    readonly admissions: readonly Readonly<Record<string, unknown>>[];
    /** Local x402 wallet policies (`wallet policy set`), one row per x402 network and asset. */
    readonly walletPolicies?: readonly Readonly<Record<string, unknown>>[];
    /** Solana and TRON direct-rail admissions (`chain policy admit`), one row per rail and asset alias. */
    readonly chainPolicies?: readonly Readonly<Record<string, unknown>>[];
}
/** The parsed global policy document; read on every policy read so an operator edit takes effect at once. */
export declare function readGlobalPolicyDocument(path: string): Promise<GlobalAllowlistPolicyFile>;
export declare function globalPolicyPath(): string | null;
/** Refuses per-profile staging and activation while the server's global policy is in force. */
export declare function assertNoGlobalPolicy(): void;
export interface GlobalPolicyBinding {
    readonly record: AllowlistPolicyRecordV2;
    /** Stable for one file and one profile, so digests frozen at prepare match at approve. */
    readonly approvalFingerprint: string;
    readonly decidedAt: string;
}
/** The global policy compiled for one profile, or null when the profile holds no account the policy admits. */
export declare function bindGlobalPolicy(root: string, path: string, profile: string): Promise<GlobalPolicyBinding | null>;
