import type { LegacyStargateEnvelope } from "./native-record.js";
export declare const LEGACY_TOKEN_SCHEMAS: readonly ["apn.stargate-v2-token-operation.v1", "apn.stargate-v2-token-operation.v2", "apn.stargate-v2-token-operation.v3", "apn.stargate-v2-token-operation.v4"];
export type LegacyTokenPhase = "prepared" | "approved" | "allowance_submission_started" | "allowance_unknown_finality" | "allowance_submitted" | "allowance_observed" | "post_approval_quote_bound" | "submission_started" | "unknown_finality" | "submitted" | "observed" | "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned";
/** Optimism USDC to Polygon USDC as an unreleased 2026-09-20 build wrote it; read-only in every APN since 0.5.45. */
export interface LegacyStargateTokenRecord {
    readonly schemaVersion: typeof LEGACY_TOKEN_SCHEMAS[number];
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly owner: string;
    readonly recipient: string;
    readonly expiresAt: string;
    readonly phase: LegacyTokenPhase;
    readonly approvalEnvelope?: LegacyStargateEnvelope;
    readonly sendEnvelope: LegacyStargateEnvelope;
    readonly cleanupEnvelope?: LegacyStargateEnvelope;
    readonly approvalTransactionHash?: string;
    readonly transactionHash?: string;
    readonly cleanupTransactionHash?: string;
    readonly transitions: readonly {
        readonly phase: LegacyTokenPhase;
        readonly at: string;
        readonly reason: string;
    }[];
    readonly integrityHash: string;
    readonly [field: string]: unknown;
}
/**
 * The 60b247d5^ token reader restricted to schemas v1..v4, unchanged in what it accepts: integrity seal, the v1 lane and
 * historical all-safe policy or the pinned policy, the v3/v4 bridge-simulation binding, the v4 fee approval, none of the v5
 * approval-finality fields, usage states, the mechanism pin, cleanup markers and the transition table. The record is
 * returned as stored. Any other failure is corrupt state.
 */
export declare function validateLegacyTokenRecord(value: unknown): LegacyStargateTokenRecord;
