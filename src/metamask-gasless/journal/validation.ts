import { hashObject, sha256 } from "../../canonical.js";
import { mmImmutable, mmMutable, MM_HISTORY_LIMIT, MM_OPERATION_KIND, MM_OPERATION_VERSION, MM_TERMINAL,
  mmRequestHash, type MetaMaskGaslessOperationRecord, type MetaMaskGaslessTransition } from "../operation-model.js";
import type { MetaMaskGaslessMutable, MetaMaskGaslessState } from "../model.js";
import { MM_ZERO_HASH } from "../model.js";
import { mmFail } from "../reasons.js";
import { mmExact, mmHash, mmIso, mmSame } from "../validation.js";
import { mmJournalIntent, mmJournalMutable } from "./schema.js";

const MUTABLE_KEYS = ["state", "approval", "submissionAttempts", "dispatchStartedAt", "dispatch",
  "providerObservation", "cursor", "observation", "settlement", "failure"] as const;
const TRANSITION_KEYS = ["at", "previousHash", ...MUTABLE_KEYS, "transitionHash"] as const;
const OPERATION_KEYS = ["schemaVersion", "kind", "profileHash", "operationId", "idempotencyHash", "requestHash",
  "fingerprint", "createdAt", "updatedAt", "terminal", "intent", ...MUTABLE_KEYS, "transitions", "integrityHash"] as const;
const EDGES: Readonly<Record<MetaMaskGaslessState, readonly MetaMaskGaslessState[]>> = {
  awaiting_approval: ["execution_pending", "failed_before_effect"],
  execution_pending: ["dispatch_pending", "failed_before_effect"],
  dispatch_pending: ["submitted_pending", "unknown_finality", "failed_effects_pending", "completed"],
  submitted_pending: ["submitted_pending", "unknown_finality", "failed_effects_pending", "completed", "abandoned_unknown"],
  unknown_finality: ["submitted_pending", "unknown_finality", "failed_effects_pending", "completed", "abandoned_unknown"],
  failed_effects_pending: ["failed_effects_pending", "completed"],
  completed: [], failed_before_effect: [], abandoned_unknown: [],
};

function corrupt(): never { return mmFail("mm_gasless_state_corrupt"); }
/**
 * `dispatch` was added with the reprice guard. A stored record written without it keeps its exact key set, so its
 * transition and integrity hashes stay verifiable; the field is then absent rather than defaulted.
 */
function keysFor(value: unknown, keys: readonly string[]): readonly string[] {
  return typeof value === "object" && value !== null && Object.hasOwn(value, "dispatch")
    ? keys : keys.filter(key => key !== "dispatch");
}
/**
 * `undefined` is a transition written before the dispatched material existed, and canonical JSON cannot represent it,
 * so presence is compared before value. Absent and present-and-null stay distinct: only an unchanged field passes.
 */
function sameDispatch(previous: unknown, next: unknown): boolean {
  if (previous === undefined || next === undefined) return previous === next;
  return mmSame(previous, next);
}
function time(value: string): number { return Date.parse(value); }
function mutable(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(MUTABLE_KEYS.map(key => [key, value[key]]));
}
function transition(value: unknown, intent: MetaMaskGaslessOperationRecord["intent"], fingerprint: string): MetaMaskGaslessTransition {
  const t = mmExact(value, keysFor(value, TRANSITION_KEYS)), at = mmIso(t.at), previousHash = mmHash(t.previousHash);
  const transitionHash = mmHash(t.transitionHash), { transitionHash: _hash, ...body } = t;
  if (hashObject(body) !== transitionHash) corrupt();
  const normalized = mmJournalMutable(mutable(t), intent, fingerprint, at);
  return { ...normalized, at, previousHash, transitionHash };
}
function step(previous: MetaMaskGaslessTransition, next: MetaMaskGaslessTransition): void {
  if (!EDGES[previous.state].includes(next.state) || time(next.at) < time(previous.at)) corrupt();
  if (previous.approval !== null && !mmSame(previous.approval, next.approval)) corrupt();
  if (previous.submissionAttempts > next.submissionAttempts) corrupt();
  if (previous.submissionAttempts === 0 && next.submissionAttempts === 1 &&
    (previous.state !== "execution_pending" || next.state !== "dispatch_pending" || next.dispatchStartedAt !== next.at)) corrupt();
  // The dispatched material is written once, with the marker, and can never be replaced afterwards.
  if (previous.submissionAttempts === 1 && (next.submissionAttempts !== 1 ||
    previous.dispatchStartedAt !== next.dispatchStartedAt || !sameDispatch(previous.dispatch, next.dispatch))) corrupt();
  if (previous.settlement !== null && !mmSame(previous.settlement, next.settlement)) corrupt();
  if (previous.providerObservation !== null && next.providerObservation !== null) {
    if (time(next.providerObservation.observedAt) < time(previous.providerObservation.observedAt) ||
      previous.providerObservation.requestIdHash !== next.providerObservation.requestIdHash) corrupt();
  }
  if (next.providerObservation?.status === "unavailable" &&
    next.providerObservation.txHash !== (previous.providerObservation?.txHash ?? null)) corrupt();
  if (previous.observation !== null && next.observation !== null &&
    time(next.observation.observedAt) < time(previous.observation.observedAt)) corrupt();
  const before = BigInt(previous.cursor.nextBlockAtomic), after = BigInt(next.cursor.nextBlockAtomic);
  if (after < before || !mmSame(previous.cursor.startBlock, next.cursor.startBlock)) corrupt();
  if (after === before && !mmSame(previous.cursor, next.cursor)) corrupt();
  if (previous.cursor.previousEndBlock !== null && next.cursor.previousEndBlock !== null) {
    const p = BigInt(previous.cursor.previousEndBlock.numberAtomic), n = BigInt(next.cursor.previousEndBlock.numberAtomic);
    if (n < p || (n === p && !mmSame(previous.cursor.previousEndBlock, next.cursor.previousEndBlock))) corrupt();
  }
  if (previous.state === "failed_effects_pending" && next.state !== "failed_effects_pending" && next.state !== "completed") corrupt();
  if (previous.state !== "failed_effects_pending" && next.state === "failed_effects_pending" &&
    next.observation?.phase !== "reverted") corrupt();
  if (previous.state === "failed_effects_pending" && next.state === "failed_effects_pending" &&
    previous.failure?.reason !== next.failure?.reason) corrupt();
}

function validate(value: unknown): MetaMaskGaslessOperationRecord {
  const r = mmExact(value, keysFor(value, OPERATION_KEYS));
  if (r.schemaVersion !== MM_OPERATION_VERSION || r.kind !== MM_OPERATION_KIND || typeof r.terminal !== "boolean") corrupt();
  const profileHash = mmHash(r.profileHash), operationId = mmHash(r.operationId), idempotencyHash = mmHash(r.idempotencyHash);
  const requestHash = mmHash(r.requestHash), fingerprint = mmHash(r.fingerprint);
  const createdAt = mmIso(r.createdAt), updatedAt = mmIso(r.updatedAt);
  if (time(updatedAt) < time(createdAt)) corrupt();
  const intent = mmJournalIntent(r.intent, profileHash);
  if (intent.profile.length === 0 || profileHash !== sha256(`profile\0${intent.profile}`) || createdAt !== intent.preparedAt) corrupt();
  const immutable = { schemaVersion: MM_OPERATION_VERSION, kind: MM_OPERATION_KIND, profileHash, operationId,
    idempotencyHash, requestHash, createdAt, intent };
  if (fingerprint !== hashObject(mmImmutable(immutable))) corrupt();
  const expectedRequestHash = mmRequestHash(profileHash, intent);
  if (requestHash !== expectedRequestHash || !Array.isArray(r.transitions) || r.transitions.length < 1 ||
    r.transitions.length > MM_HISTORY_LIMIT) corrupt();
  const transitions: MetaMaskGaslessTransition[] = [];
  for (const raw of r.transitions) {
    const current = transition(raw, intent, fingerprint), prior = transitions.at(-1);
    if (prior === undefined) {
      const initial: MetaMaskGaslessMutable = { state: "awaiting_approval", approval: null, submissionAttempts: 0,
        dispatchStartedAt: null, dispatch: current.dispatch === undefined ? undefined : null, providerObservation: null,
        cursor: { startBlock: intent.initialSnapshot.safeBlock, nextBlockAtomic: intent.initialSnapshot.safeBlock.numberAtomic,
          previousEndBlock: null }, observation: null, settlement: null, failure: null };
      if (current.previousHash !== MM_ZERO_HASH || current.at !== createdAt || !mmSame(mmMutable(current), initial)) corrupt();
    } else {
      if (current.previousHash !== prior.transitionHash) corrupt();
      step(prior, current);
    }
    if (current.approval !== null && time(current.approval.approvedAt) < time(createdAt)) corrupt();
    if (current.dispatchStartedAt !== null) {
      for (const observedAt of [current.providerObservation?.observedAt, current.observation?.observedAt,
        current.settlement?.observedAt]) if (observedAt !== undefined && time(observedAt) < time(current.dispatchStartedAt)) corrupt();
    }
    transitions.push(current);
  }
  const last = transitions.at(-1)!;
  const currentMutable = mmJournalMutable(mutable(r), intent, fingerprint, updatedAt);
  if (last.at !== updatedAt || !mmSame(mmMutable(last), currentMutable) ||
    r.terminal !== MM_TERMINAL.includes(currentMutable.state)) corrupt();
  const operation: MetaMaskGaslessOperationRecord = { ...immutable, fingerprint, updatedAt, terminal: r.terminal,
    ...currentMutable, transitions, integrityHash: mmHash(r.integrityHash) };
  const { integrityHash, ...body } = operation;
  if (integrityHash !== hashObject(body)) corrupt();
  return operation;
}

export function validateMetaMaskGaslessOperation(value: unknown): MetaMaskGaslessOperationRecord {
  try { return validate(value); } catch { return corrupt(); }
}

export function validateMetaMaskGaslessContinuity(previous: MetaMaskGaslessOperationRecord,
  next: MetaMaskGaslessOperationRecord): void {
  const before = validateMetaMaskGaslessOperation(previous), after = validateMetaMaskGaslessOperation(next);
  if (mmSame(before, after)) return;
  if (before.terminal || before.fingerprint !== after.fingerprint ||
    !mmSame(mmImmutable(before), mmImmutable(after)) || after.transitions.length !== before.transitions.length + 1 ||
    !mmSame(before.transitions, after.transitions.slice(0, -1))) corrupt();
}
