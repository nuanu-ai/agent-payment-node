import type { Hex } from "../model.js";
import type { GaslessCursor, GaslessEstimate, GaslessIntent, GaslessObservation, GaslessSettlement } from "./model.js";
export type GaslessState = "awaiting_approval" | "execution_pending" | "bootstrap_pending" | "user_operation_pending" | "submitted_pending" | "included_success" | "included_revert" | "unknown_finality" | "failed_effects_pending" | "completed" | "failed_before_effect" | "failed_confirmed_revert" | "failed_permissions_invalidated";
export type GaslessRole = "bootstrap" | "user_operation";
export type GaslessEffectPhase = "unsealed" | "signing_started" | "sealed" | "disclosure_started" | "checked" | "submitting" | "submitted_pending" | "unknown_finality" | "included_success" | "included_revert" | "safe_success" | "safe_revert";
export interface GaslessConsent {
    readonly policy: "apn.gasless.foreground-approval.v1";
    readonly fingerprint: string;
    readonly approvedAt: string;
    readonly expiresAt: string;
}
export interface GaslessEffect {
    readonly role: GaslessRole;
    readonly phase: GaslessEffectPhase;
    readonly signingAttempts: 0 | 1;
    readonly materialHash: string | null;
    readonly disclosureAttempts: 0 | 1;
    readonly submissionAttempts: 0 | 1;
    readonly userOperationHash: Hex | null;
    readonly estimate: GaslessEstimate | null;
    readonly signingStartedAt: string | null;
    readonly sealedAt: string | null;
    readonly disclosedAt: string | null;
    readonly submittedAt: string | null;
}
export interface GaslessMutable {
    readonly state: GaslessState;
    readonly approval: GaslessConsent | null;
    readonly bootstrap: GaslessEffect;
    readonly userOperation: GaslessEffect;
    readonly cursor: GaslessCursor;
    readonly observation: GaslessObservation | null;
    readonly settlement: GaslessSettlement | null;
    readonly failure: string | null;
}
export interface GaslessTransition extends GaslessMutable {
    readonly at: string;
    readonly previousHash: string;
    readonly transitionHash: string;
}
export interface GaslessOperationRecord extends GaslessMutable {
    readonly schemaVersion: "apn.gasless-operation.v1";
    readonly kind: "gasless_transfer";
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly terminal: boolean;
    readonly intent: GaslessIntent;
    readonly transitions: readonly GaslessTransition[];
    readonly integrityHash: string;
}
export declare const GASLESS_TERMINAL: readonly GaslessState[];
export declare function gaslessIntentBinding(op: Pick<GaslessOperationRecord, "schemaVersion" | "kind" | "profileHash" | "operationId" | "idempotencyHash" | "requestHash" | "intent">): {
    schemaVersion: "apn.gasless-operation.v1";
    kind: "gasless_transfer";
    profileHash: string;
    operationId: string;
    idempotencyHash: string;
    requestHash: string;
    intent: GaslessIntent;
};
export declare function newGaslessEffect(role: GaslessRole): GaslessEffect;
export declare function gaslessSnapshot(op: GaslessMutable): GaslessMutable;
export declare function sealGaslessOperation(op: Omit<GaslessOperationRecord, "integrityHash">): GaslessOperationRecord;
