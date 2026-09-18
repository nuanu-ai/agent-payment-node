import type { ChainAccount, RailFinalEvidence, RailPreparedTransfer, RailSendBinding } from "./direct-rail-ports.js";
import { type DirectAllowlistBinding } from "./direct-allowlist-gate.js";
import type { DirectAssetUsageLease } from "./direct-asset-usage.js";
export type RailState = "awaiting_approval" | "signing_started" | "signed_not_submitted" | "submitting" | "submitted_pending" | "unknown_finality" | "completed" | "failed_before_effect" | "failed_confirmed_revert" | "abandoned_unknown";
interface RailTransition {
    readonly state: RailState;
    readonly at: string;
    readonly reason: string;
    readonly proofClass: string;
    readonly transactionId: string | null;
    readonly rawPayloadHash: string | null;
    readonly evidence: RailFinalEvidence | null;
    readonly previousHash: string;
    readonly transitionHash: string;
}
interface RailIntent {
    readonly schemaVersion: "apn.rail-operation.v1";
    readonly kind: "rail_transfer";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly account: ChainAccount;
    readonly prepared: RailPreparedTransfer;
    readonly policyHash: string;
    /** Owner allowlist revision frozen at prepare, inside the fingerprint. Absent on records written before the gate. */
    readonly allowlist?: DirectAllowlistBinding;
}
export interface RailOperationRecord extends RailIntent {
    readonly fingerprint: string;
    /**
     * Written exactly once, with the `signing_started` transition, by rails whose send guard
     * re-acquires a validity window. Outside the fingerprint, so re-acquiring it never restates the
     * intent the owner approved. Omitted entirely on every record that never re-bound.
     */
    readonly send?: RailSendBinding;
    /** The shared usage reservation, written once with the first signing or send transition. Outside the fingerprint. */
    readonly allowlistLease?: DirectAssetUsageLease;
    readonly state: RailState;
    readonly terminal: boolean;
    readonly reason: string;
    readonly proofClass: string;
    readonly transactionId: string | null;
    readonly rawPayloadHash: string | null;
    readonly evidence: RailFinalEvidence | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly transitions: readonly RailTransition[];
    readonly integrityHash: string;
}
export type RailReceipt = ReturnType<typeof railReceipt>;
export declare function newRailOperation(intent: RailIntent): RailOperationRecord;
export declare function transitionRail(operation: RailOperationRecord, input: {
    readonly state: RailState;
    readonly at: string;
    readonly reason: string;
    readonly proofClass: string;
    readonly transactionId?: string;
    readonly rawPayloadHash?: string;
    readonly evidence?: RailFinalEvidence;
    readonly send?: RailSendBinding;
    readonly allowlistLease?: DirectAssetUsageLease;
}): RailOperationRecord;
export declare function validateRailContinuity(previous: RailOperationRecord, next: RailOperationRecord): void;
export declare function validateRailOperation(value: unknown): RailOperationRecord;
export declare function validateRailPrepared(value: unknown, account: ChainAccount): RailPreparedTransfer;
export declare function validateRailEvidence(value: unknown, prepared: RailPreparedTransfer, transactionId: string, success: boolean): asserts value is RailFinalEvidence;
export declare function validateRailTransactionId(value: unknown, rail: ChainAccount["rail"]): asserts value is string;
export declare function publicRailOperation(operation: RailOperationRecord): {
    state: RailState;
    terminal: boolean;
    proof_class: string;
    reason: string;
    transaction_id: string | null;
    evidence: RailFinalEvidence | null;
    created_at: string;
    updated_at: string;
    next_actions: readonly string[];
    send_binding?: RailSendBinding;
    transfer: {
        rail: import("./direct-rail-ports.js").DirectRailName;
        networkIdentity: string;
        asset: import("./direct-rail-ports.js").ChainAsset;
        sender: string;
        recipient: string;
        amountAtomic: string;
        maximumFeeAtomic: string;
        economics: import("./direct-rail-ports.js").RailEconomics;
        preparedAt: string;
        expiresAt: string;
        blockReference: string;
        lastValidBlockHeight: string | null;
        sourceTokenAccount: string | null;
        destinationTokenAccount: string | null;
        createsRecipientAccount: boolean;
        resources?: import("./tron/model.js").TronResourceSnapshot;
    };
    allowlist?: unknown;
    kind: "rail_transfer";
    schema_version: "apn.rail-operation.v1";
    operation_id: string;
    profile: string;
    provider: import("./direct-rail-ports.js").ChainProvider;
    custody: "local_software" | "provider_managed";
    account: string;
    fingerprint: string;
    policy_hash: string;
};
export declare function railNextActions(operation: RailOperationRecord): readonly string[];
export declare function railReceipt(operation: RailOperationRecord): {
    receipt_hash: string;
    schema_version: "apn.rail-receipt.v1";
    operation_binding_hash: string;
    state: RailState;
    terminal: boolean;
    proof_class: string;
    reason: string;
    transaction_id: string | null;
    evidence: RailFinalEvidence | null;
    created_at: string;
    updated_at: string;
    next_actions: readonly string[];
    send_binding?: RailSendBinding;
    transfer: {
        rail: import("./direct-rail-ports.js").DirectRailName;
        networkIdentity: string;
        asset: import("./direct-rail-ports.js").ChainAsset;
        sender: string;
        recipient: string;
        amountAtomic: string;
        maximumFeeAtomic: string;
        economics: import("./direct-rail-ports.js").RailEconomics;
        preparedAt: string;
        expiresAt: string;
        blockReference: string;
        lastValidBlockHeight: string | null;
        sourceTokenAccount: string | null;
        destinationTokenAccount: string | null;
        createsRecipientAccount: boolean;
        resources?: import("./tron/model.js").TronResourceSnapshot;
    };
    allowlist?: unknown;
    kind: "rail_transfer";
    operation_id: string;
    profile: string;
    provider: import("./direct-rail-ports.js").ChainProvider;
    custody: "local_software" | "provider_managed";
    account: string;
    fingerprint: string;
    policy_hash: string;
};
export declare function railHistoricalReceipt(operation: RailOperationRecord, transitionIndex: number): RailReceipt;
export {};
