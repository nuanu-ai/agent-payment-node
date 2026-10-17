export declare const LEGACY_NATIVE_SCHEMA = "apn.stargate-v2-native-operation.v1";
export type LegacyNativePhase = "prepared" | "approved" | "submission_started" | "submitted" | "observed" | "unknown_finality" | "failed_confirmed_revert";
/** The signed shape both lanes froze; only the fields a reader or the closure check reads are typed. */
export interface LegacyStargateEnvelope {
    readonly chainId: number;
    readonly from: string;
    readonly to: string;
    readonly nonceAtomic: string;
    readonly [field: string]: unknown;
}
interface Transition<P> {
    readonly phase: P;
    readonly at: string;
    readonly reason: string;
}
/** Native ETH from Ethereum to Unichain as an unreleased 2026-09-20 build wrote it; read-only in every APN since 0.5.45. */
export interface LegacyStargateNativeRecord {
    readonly schemaVersion: typeof LEGACY_NATIVE_SCHEMA;
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly owner: string;
    readonly recipient: string;
    readonly expiresAt: string;
    readonly phase: LegacyNativePhase;
    readonly envelope: LegacyStargateEnvelope;
    readonly transactionHash?: string;
    readonly transitions: readonly Transition<LegacyNativePhase>[];
    readonly integrityHash: string;
    readonly [field: string]: unknown;
}
/**
 * The 60b247d5^ native reader restricted to schema v1, unchanged in what it accepts: integrity seal, last transition,
 * the pinned lane, the historical all-safe finality policy (absent, or exactly the derived one), no owner policy binding
 * (v1 predates it) and the transition order. It returns the record as stored (the old reader also sealed a derived policy
 * into its in-memory copy for its runtime; nothing executes these records any more). Any other failure is corrupt state.
 */
export declare function validateLegacyNativeRecord(value: unknown): LegacyStargateNativeRecord;
export {};
