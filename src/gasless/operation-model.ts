import { hashObject } from "../canonical.js";
import type { Hex } from "../model.js";
import type { GaslessCursor, GaslessEstimate, GaslessIntent, GaslessObservation, GaslessSettlement } from "./model.js";

export type GaslessState = "awaiting_approval" | "execution_pending" | "bootstrap_pending" |
  "submission_pending" | "unknown_finality" | "failed_effects_pending" |
  "completed" | "failed_before_effect" | "failed_confirmed_revert";
export type GaslessRole = "bootstrap" | "user_operation";
export type GaslessEffectPhase = "unsealed" | "signing_started" | "sealed" |
  "disclosure_started" | "estimate_checked" | "submitting" | "submitted_pending" | "unknown_finality";
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
export const GASLESS_TERMINAL: readonly GaslessState[] = ["completed", "failed_before_effect", "failed_confirmed_revert"];
export function gaslessIntentBinding(op: Pick<GaslessOperationRecord,
  "schemaVersion" | "kind" | "profileHash" | "operationId" | "idempotencyHash" | "requestHash" | "intent">) {
  return { schemaVersion: op.schemaVersion, kind: op.kind, profileHash: op.profileHash,
    operationId: op.operationId, idempotencyHash: op.idempotencyHash, requestHash: op.requestHash, intent: op.intent };
}
export function newGaslessEffect(role: GaslessRole): GaslessEffect {
  return { role, phase: "unsealed", signingAttempts: 0, materialHash: null, disclosureAttempts: 0,
    submissionAttempts: 0, userOperationHash: null, estimate: null, signingStartedAt: null,
    sealedAt: null, disclosedAt: null, submittedAt: null };
}
export function gaslessSnapshot(op: GaslessMutable): GaslessMutable {
  return { state: op.state, approval: op.approval, bootstrap: op.bootstrap, userOperation: op.userOperation,
    cursor: op.cursor, observation: op.observation, settlement: op.settlement, failure: op.failure };
}
export function sealGaslessOperation(op: Omit<GaslessOperationRecord, "integrityHash">): GaslessOperationRecord {
  return { ...op, integrityHash: hashObject(op) };
}
