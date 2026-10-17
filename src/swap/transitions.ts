import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { AssetUsageReservation } from "../asset-usage-ledger.js";
import { SWAP_OPERATION_SCHEMA, validateSwapOperation, type SwapOperationRecord, type SwapOperationState,
  type SwapReceiptProof, type SwapSubmissionMarker } from "./model.js";
// Readers of stable USDC to USDT records a released version wrote (SWAP-10): only the frozen no-send recovery reaches them.
import { isOrcaStableGuardedMechanismDigest } from "../legacy/orca-stable/mechanism.js";
import { validateOrcaStableNoSendProof, type OrcaStableNoSendProof } from "../legacy/orca-stable/no-send-proof.js";

export type SwapTransitionEvidence = {
  readonly usageLease?: AssetUsageReservation;
  readonly submissionMarker?: SwapSubmissionMarker;
  readonly receiptProof?: SwapReceiptProof;
  readonly failureProofHash?: string;
  readonly orcaStableNoSendProof?: OrcaStableNoSendProof;
};

const ALLOWED: Readonly<Record<SwapOperationState, readonly SwapOperationState[]>> = {
  quoted: ["prepared", "failed_before_effect"],
  prepared: ["awaiting_approval", "failed_before_effect"],
  awaiting_approval: ["reserved", "failed_before_effect"],
  reserved: ["submitting", "failed_before_effect"],
  submitting: ["submitted", "unknown_finality"],
  submitted: ["unknown_finality", "finalized", "failed_confirmed_revert"],
  unknown_finality: ["finalized", "failed_confirmed_revert", "expired_unlanded", "abandoned_unknown"],
  finalized: [],
  failed_before_effect: [],
  failed_confirmed_revert: [],
  expired_unlanded: [],
  abandoned_unknown: [],
};

export function transitionSwapOperation(opValue: unknown, state: SwapOperationState, evidence: SwapTransitionEvidence, now: Date): SwapOperationRecord {
  const op = validateSwapOperation(opValue);
  if (!isPlainRecord(evidence) || !exactKeys(evidence, [
    ...(evidence.usageLease === undefined ? [] : ["usageLease"]),
    ...(evidence.submissionMarker === undefined ? [] : ["submissionMarker"]),
    ...(evidence.receiptProof === undefined ? [] : ["receiptProof"]),
    ...(evidence.failureProofHash === undefined ? [] : ["failureProofHash"]),
    ...(evidence.orcaStableNoSendProof === undefined ? [] : ["orcaStableNoSendProof"]),
  ])) invalid("Swap transition evidence is invalid.");
  const stableRecovery = op.state === "submitting" && state === "failed_before_effect" &&
    isOrcaStableGuardedMechanismDigest(op.mechanismDigest);
  if (!ALLOWED[op.state].includes(state) && !stableRecovery) blocked("Swap operation transition is invalid.");
  const at = instant(now); if (at < op.updatedAt) blocked("Swap operation transition cannot move backward in time.");
  const patch = transitionPatch(op, state, evidence, at);
  const { integrityHash: previousIntegrityHash, ...current } = op;
  const body = { ...current, ...patch, state, revision: op.revision + 1, updatedAt: at, previousIntegrityHash };
  return validateSwapOperation({ ...body, integrityHash: domainHash(SWAP_OPERATION_SCHEMA, canonicalJson(body)) });
}

function transitionPatch(op: SwapOperationRecord, state: SwapOperationState, evidence: SwapTransitionEvidence, at: string): Partial<SwapOperationRecord> {
  if (state === "prepared" || state === "awaiting_approval") {
    if (Object.keys(evidence).length !== 0) invalid("This swap transition accepts no additional evidence.");
    return {};
  }
  if (state === "reserved") {
    if (evidence.usageLease?.state !== "reserved" || Object.keys(evidence).length !== 1) invalid("Reserved swap requires its exact reserved usage lease.");
    return { usageLease: evidence.usageLease };
  }
  if (state === "submitting") {
    if (evidence.submissionMarker === undefined || Object.keys(evidence).length !== 1 || evidence.submissionMarker.markedAt !== at) {
      invalid("Submitting swap requires one freshly persisted submission marker.");
    }
    return { submissionMarker: evidence.submissionMarker };
  }
  if (state === "submitted" || state === "unknown_finality") {
    if (evidence.usageLease === undefined || Object.keys(evidence).some((key) => key !== "usageLease" && key !== "receiptProof") ||
        evidence.usageLease.state !== (state === "submitted" ? "submitted" : "unknown_finality")) {
      invalid("Post-send swap transition requires its matching charged usage lease.");
    }
    return { usageLease: evidence.usageLease, ...(evidence.receiptProof === undefined ? {} : { receiptProof: evidence.receiptProof }) };
  }
  if (state === "finalized") {
    if (evidence.usageLease?.state !== "finalized" || evidence.receiptProof?.finalized !== true || Object.keys(evidence).length !== 2) {
      invalid("Finalized swap requires a finalized usage lease and receipt proof.");
    }
    return { usageLease: evidence.usageLease, receiptProof: evidence.receiptProof };
  }
  if (state === "failed_confirmed_revert") {
    if (evidence.usageLease?.state !== "failed_confirmed_revert" || evidence.receiptProof?.finalized !== true ||
        evidence.failureProofHash !== evidence.receiptProof.receiptHash || Object.keys(evidence).length !== 3) {
      invalid("Confirmed swap revert requires a released lease and its finalized revert proof.");
    }
    return { usageLease: evidence.usageLease, receiptProof: evidence.receiptProof, failureProofHash: evidence.failureProofHash };
  }
  if (state === "expired_unlanded" || state === "abandoned_unknown") {
    // Expired: the chain proved no landing, so the hold is released. Abandoned: no proof exists, so the input stays charged.
    const leaseState = state === "expired_unlanded" ? "released_unsubmitted" : "finalized";
    if (op.receiptProof !== null || op.submissionMarker === null || evidence.usageLease?.state !== leaseState ||
        evidence.failureProofHash === undefined || !/^[a-f0-9]{64}$/u.test(evidence.failureProofHash) ||
        evidence.usageLease.outcomeDigest !== evidence.failureProofHash || evidence.usageLease.reservationId !== op.usageLease?.reservationId ||
        Object.keys(evidence).length !== 2) {
      invalid("This terminal swap requires its proof or acknowledgement digest and the lease bound to it.");
    }
    return { usageLease: evidence.usageLease, failureProofHash: evidence.failureProofHash };
  }
  if (state === "failed_before_effect") {
    if (op.state === "submitting") {
      if (!isOrcaStableGuardedMechanismDigest(op.mechanismDigest) || op.submissionMarker === null ||
          op.receiptProof !== null || op.usageLease === null || evidence.usageLease === undefined ||
          evidence.orcaStableNoSendProof === undefined || Object.keys(evidence).length !== 3) {
        invalid("Marked stable failure requires its exact no-send proof and released lease.");
      }
      const proof = validateOrcaStableNoSendProof(evidence.orcaStableNoSendProof);
      if (proof.operationId !== op.operationId || proof.ownerProfileHash !== op.ownerProfileHash ||
          proof.quoteHash !== op.quote.quoteHash || proof.markerHash !== op.submissionMarker.markerHash ||
          proof.markerOperationIntegrityHash !== op.submissionMarker.operationIntegrityHash ||
          proof.reservationId !== op.usageLease.reservationId ||
          proof.reservedLeaseIntegrityHash !== op.usageLease.reservationDigest ||
          evidence.failureProofHash !== proof.proofHash || evidence.usageLease.outcomeDigest !== proof.proofHash ||
          evidence.usageLease.reservationId !== op.usageLease.reservationId ||
          evidence.usageLease.state !== "failed_before_effect") {
        invalid("Marked stable no-send proof does not bind the operation and lease.");
      }
      return { failureProofHash: proof.proofHash, usageLease: evidence.usageLease };
    }
    if (evidence.failureProofHash === undefined || !/^[a-f0-9]{64}$/u.test(evidence.failureProofHash) ||
        (evidence.usageLease !== undefined && evidence.usageLease.state !== "failed_before_effect") ||
        Object.keys(evidence).some((key) => key !== "failureProofHash" && key !== "usageLease")) {
      invalid("Pre-effect failure requires bound proof and any lease must already be released.");
    }
    return { failureProofHash: evidence.failureProofHash, ...(evidence.usageLease === undefined ? {} : { usageLease: evidence.usageLease }) };
  }
  return invalid("Swap transition is unsupported.");
}

function instant(value: Date): string { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid("Swap transition time is invalid."); return value.toISOString(); }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
