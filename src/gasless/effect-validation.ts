import { assertGaslessEstimate } from "./economics.js";
import type { GaslessEffect, GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
import { assertGaslessPermissionClosure } from "./permission-invalidation.js";
import { validateGaslessSettlement } from "./settlement-validation.js";
import { gaslessFailure, gaslessSame } from "./validation.js";

const corrupt = (): never => gaslessFailure("APN_STATE_CORRUPT", "gasless_effect_binding");
export function validateGaslessMutable(op: GaslessOperationRecord, s: GaslessMutable, at: string): void {
  if (s.bootstrap.role !== "bootstrap" || s.userOperation.role !== "user_operation") corrupt();
  for (const effect of [s.bootstrap, s.userOperation]) validateEffect(effect, at);
  const consent = s.approval;
  if (consent !== null && (consent.fingerprint !== op.fingerprint || consent.expiresAt !== op.intent.expiresAt ||
    consent.approvedAt < op.createdAt || consent.approvedAt > at || consent.approvedAt >= consent.expiresAt)) corrupt();
  for (const e of [s.bootstrap, s.userOperation]) {
    if (e.signingAttempts === 1 && (consent === null || e.signingStartedAt! < consent.approvedAt || e.signingStartedAt! >= op.intent.expiresAt)) corrupt();
    if (e.disclosedAt !== null && e.disclosedAt >= op.intent.expiresAt) corrupt();
    if (e.submittedAt !== null && e.submittedAt >= op.intent.expiresAt) corrupt();
  }
  if (s.state === "awaiting_approval" && (consent !== null || s.bootstrap.signingAttempts !== 0)) corrupt();
  if (s.state !== "awaiting_approval" && s.state !== "failed_before_effect" && consent === null) corrupt();
  if (s.bootstrap.estimate !== null) assertGaslessEstimate(op.intent, s.bootstrap.estimate);
  if (s.userOperation.signingAttempts === 1 && (s.bootstrap.phase !== "checked" || s.bootstrap.estimate === null)) corrupt();
  if (!gaslessSame(s.cursor.startBlock, op.intent.initialSnapshot.block) ||
    BigInt(s.cursor.nextBlockAtomic) < BigInt(s.cursor.startBlock.numberAtomic) ||
    (s.cursor.previousEndBlock !== null && BigInt(s.cursor.previousEndBlock.numberAtomic) + 1n !== BigInt(s.cursor.nextBlockAtomic))) corrupt();
  const observed = s.observation?.settlement ?? null;
  if (s.observation !== null) {
    const o = s.observation;
    if ((o.status === "permissions_invalidated") !== (o.permissionInvalidation !== undefined) ||
      (o.status === "permissions_invalidated") !== (s.state === "failed_permissions_invalidated")) corrupt();
    if (!gaslessSame(o.cursor, s.cursor) || (o.status === "safe") !== (o.settlement !== null) ||
      (o.settlement !== null && (o.transactionHash !== o.settlement.transactionHash || o.evidenceHash === null)) ||
      (s.userOperation.submissionAttempts !== 1 && (o.transactionHash !== null || o.settlement !== null))) corrupt();
  }
  if (s.state === "failed_permissions_invalidated") {
    assertGaslessPermissionClosure(op, s);
    if (s.failure !== s.observation!.reason) corrupt();
  }
  for (const p of [observed, s.settlement]) {
    if (p === null) continue;
    if (s.userOperation.userOperationHash === null || s.userOperation.submissionAttempts !== 1) corrupt();
    validateGaslessSettlement(op.intent, s.userOperation.userOperationHash!, p);
  }
  if (s.settlement !== null && !gaslessSame(s.settlement, observed)) corrupt();
  const terminalProof = s.settlement;
  if (s.state === "completed" && (terminalProof === null || !terminalProof.accounting.success ||
    terminalProof.safeAccount.allowanceAtomic !== "0" || s.userOperation.phase !== "safe_success" || s.failure !== null)) corrupt();
  if (s.state === "failed_confirmed_revert" && (terminalProof === null || terminalProof.accounting.success ||
    terminalProof.safeAccount.allowanceAtomic !== "0" || s.userOperation.phase !== "safe_revert" || s.failure === null)) corrupt();
  if (s.state === "failed_effects_pending" && (observed === null || observed.accounting.success ||
    observed.safeAccount.allowanceAtomic === "0" || s.failure === null)) corrupt();
  if (s.state === "failed_before_effect" && (s.bootstrap.signingAttempts !== 0 || s.userOperation.signingAttempts !== 0 ||
    s.failure === null || s.observation !== null || s.settlement !== null)) corrupt();
  if (s.state === "unknown_finality" && s.bootstrap.signingAttempts === 0) corrupt();
  if (["safe_success", "safe_revert"].includes(s.userOperation.phase) && (observed === null ||
    observed.accounting.success !== (s.userOperation.phase === "safe_success"))) corrupt();
}
function validateEffect(e: GaslessEffect, at: string): void {
  if (e.signingAttempts === 0) {
    if (e.phase !== "unsealed" || e.signingStartedAt !== null || e.sealedAt !== null || e.materialHash !== null ||
      e.disclosureAttempts !== 0 || e.submissionAttempts !== 0 || e.userOperationHash !== null || e.estimate !== null ||
      e.disclosedAt !== null || e.submittedAt !== null) corrupt();
    return;
  }
  if (e.phase === "unsealed" || e.signingStartedAt === null || e.signingStartedAt > at ||
    (e.sealedAt === null) !== (e.materialHash === null) || (e.sealedAt !== null && (e.sealedAt < e.signingStartedAt || e.sealedAt > at))) corrupt();
  if (e.phase === "signing_started" && e.materialHash !== null) corrupt();
  if (!["signing_started", "unknown_finality"].includes(e.phase) && e.materialHash === null) corrupt();
  if (e.disclosureAttempts !== (e.disclosedAt === null ? 0 : 1) || e.submissionAttempts !== (e.submittedAt === null ? 0 : 1)) corrupt();
  for (const marker of [e.disclosedAt, e.submittedAt]) if (marker !== null && (e.sealedAt === null || marker < e.sealedAt || marker > at)) corrupt();
  if (e.role === "bootstrap") {
    if (!["signing_started", "sealed", "disclosure_started", "checked", "unknown_finality"].includes(e.phase) ||
      e.submissionAttempts !== 0 || e.userOperationHash !== null || (e.phase === "checked") !== (e.estimate !== null) ||
      (e.estimate !== null && e.disclosureAttempts !== 1) || (e.phase === "disclosure_started" && e.disclosureAttempts !== 1) ||
      (e.phase === "sealed" && e.disclosureAttempts !== 0)) corrupt();
  } else {
    if (["disclosure_started", "checked"].includes(e.phase) || e.disclosureAttempts !== 0 || e.estimate !== null ||
      (e.materialHash === null) !== (e.userOperationHash === null) ||
      (!["signing_started", "sealed", "unknown_finality"].includes(e.phase) && e.submissionAttempts !== 1) ||
      (e.phase === "sealed" && e.submissionAttempts !== 0)) corrupt();
  }
}
