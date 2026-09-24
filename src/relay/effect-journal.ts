/** Durable Relay effect intent and observation journal. This module cannot sign or submit. */
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { RelayUnsignedOperationRepository, validateRelayUnsignedOperation, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import type { RelayQuoteTransaction } from "./quote.js";

export type RelayEffectRole = "approval" | "deposit";
export type RelayEffectPhase = "pending" | "submission_marked" | "tx_known" | "confirmed" | "failed";
export interface RelayEffect {
  readonly role: RelayEffectRole;
  readonly phase: RelayEffectPhase;
  /** Written before any future caller may submit. A marked effect may only be observed. */
  readonly attempt: null | Readonly<{ marker: string; markedAt: string; transactionHash: string | null }>;
  readonly observedAt: string | null;
}
export interface RelayEffectJournal {
  readonly schemaVersion: "apn.relay-effect-journal.v1";
  readonly profileHash: string;
  readonly operationId: string;
  readonly preparedIntegrityHash: string;
  readonly sourceOwner: string;
  readonly quoteDigest: string;
  readonly orderId: string;
  readonly approvalEnvelope: RelayQuoteTransaction;
  readonly depositEnvelope: RelayQuoteTransaction;
  readonly effects: readonly [RelayEffect, RelayEffect];
  readonly createdAt: string;
  readonly integrityHash: string;
}
export type RelayEffectEvent =
  | Readonly<{ kind: "mark_submission"; role: RelayEffectRole; marker: string; at: string }>
  | Readonly<{ kind: "record_transaction"; role: RelayEffectRole; transactionHash: string }>
  | Readonly<{ kind: "observe"; role: RelayEffectRole; outcome: "confirmed" | "failed"; at: string }>;

function corrupt(reason: string): never { throw new ApnError("APN_STATE_CORRUPT", `Relay effect journal is invalid: ${reason}.`); }
function blocked(reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", `Relay effect transition refused: ${reason}.`); }
const HASH = /^[a-f0-9]{64}$/u;
const TX = /^0x[a-f0-9]{64}$/u;
const iso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const hexHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
function body(journal: RelayEffectJournal): Omit<RelayEffectJournal, "integrityHash"> {
  const { integrityHash: _, ...rest } = journal;
  return rest;
}
function prepared(op: RelayUnsignedOperation): asserts op is RelayUnsignedOperation & { quote: NonNullable<RelayUnsignedOperation["quote"]> } {
  validateRelayUnsignedOperation(op);
  if (op.quote === undefined || op.quote.quoteDigest !== op.quoteDigest) blocked("prepared quote required");
}
function validateEffect(effect: RelayEffect, role: RelayEffectRole): void {
  if (effect.role !== role || !["pending", "submission_marked", "tx_known", "confirmed", "failed"].includes(effect.phase)) corrupt("effect role or phase");
  if (effect.phase === "pending") {
    if (effect.attempt !== null || effect.observedAt !== null) corrupt("pending attempt");
    return;
  }
  if (effect.attempt === null || !hexHash(effect.attempt.marker) || !iso(effect.attempt.markedAt) ||
    (effect.attempt.transactionHash !== null && !TX.test(effect.attempt.transactionHash))) corrupt("attempt marker");
  if (effect.phase === "submission_marked" && (effect.attempt.transactionHash !== null || effect.observedAt !== null)) corrupt("marked state");
  if (effect.phase === "tx_known" && (effect.attempt.transactionHash === null || effect.observedAt !== null)) corrupt("known transaction");
  if ((effect.phase === "confirmed" || effect.phase === "failed") &&
    (!iso(effect.observedAt) || Date.parse(effect.observedAt) < Date.parse(effect.attempt.markedAt))) corrupt("observation");
}
export function validateRelayEffectJournal(value: unknown, op: RelayUnsignedOperation): RelayEffectJournal {
  prepared(op);
  if (value === null || typeof value !== "object" || Array.isArray(value)) corrupt("shape");
  const j = value as RelayEffectJournal;
  if (Object.keys(j).sort().join(",") !== ["schemaVersion", "profileHash", "operationId", "preparedIntegrityHash",
    "sourceOwner", "quoteDigest", "orderId", "approvalEnvelope", "depositEnvelope", "effects", "createdAt", "integrityHash"].sort().join(",") ||
    j.schemaVersion !== "apn.relay-effect-journal.v1" || j.profileHash !== op.profileHash ||
    j.operationId !== op.operationId || j.preparedIntegrityHash !== op.integrityHash ||
    j.sourceOwner !== op.sourceAccount || j.quoteDigest !== op.quoteDigest || j.orderId !== op.quote.orderId ||
    hashObject(j.approvalEnvelope) !== hashObject(op.quote.approval) ||
    hashObject(j.depositEnvelope) !== hashObject(op.quote.deposit) || !iso(j.createdAt) ||
    !Array.isArray(j.effects) || j.effects.length !== 2 || !hexHash(j.integrityHash)) corrupt("binding");
  validateEffect(j.effects[0]!, "approval"); validateEffect(j.effects[1]!, "deposit");
  if (j.effects[1]!.phase !== "pending" && j.effects[0]!.phase !== "confirmed") corrupt("deposit order");
  if (hashObject(body(j)) !== j.integrityHash) corrupt("integrity hash");
  return j;
}
export function createRelayEffectJournal(op: RelayUnsignedOperation, createdAt: string): RelayEffectJournal {
  prepared(op);
  if (!iso(createdAt)) blocked("invalid creation time");
  const pending = (role: RelayEffectRole): RelayEffect => ({ role, phase: "pending", attempt: null, observedAt: null });
  const fields: Omit<RelayEffectJournal, "integrityHash"> = {
    schemaVersion: "apn.relay-effect-journal.v1", profileHash: op.profileHash, operationId: op.operationId,
    preparedIntegrityHash: op.integrityHash, sourceOwner: op.sourceAccount, quoteDigest: op.quoteDigest,
    orderId: op.quote.orderId, approvalEnvelope: op.quote.approval, depositEnvelope: op.quote.deposit,
    effects: [pending("approval"), pending("deposit")], createdAt,
  };
  return validateRelayEffectJournal({ ...fields, integrityHash: hashObject(fields) }, op);
}

/** Pure transition. Once a submission is marked, no transition can mark it again. */
export function advanceRelayEffectJournal(journal: RelayEffectJournal, op: RelayUnsignedOperation,
  event: RelayEffectEvent): RelayEffectJournal {
  validateRelayEffectJournal(journal, op);
  const index = event.role === "approval" ? 0 : event.role === "deposit" ? 1 : blocked("role");
  const current = journal.effects[index]!;
  if (event.role === "deposit" && journal.effects[0]!.phase !== "confirmed") blocked("approval is not confirmed");
  let next: RelayEffect;
  switch (event.kind) {
    case "mark_submission":
      if (current.phase !== "pending" || !hexHash(event.marker) || !iso(event.at)) blocked("duplicate or invalid submission marker");
      next = { ...current, phase: "submission_marked", attempt: { marker: event.marker, markedAt: event.at, transactionHash: null } };
      break;
    case "record_transaction":
      if (current.phase !== "submission_marked" || !TX.test(event.transactionHash)) blocked("transaction hash requires one marked attempt");
      next = { ...current, phase: "tx_known", attempt: { ...current.attempt!, transactionHash: event.transactionHash } };
      break;
    case "observe":
      if ((current.phase !== "submission_marked" && current.phase !== "tx_known") || !iso(event.at) ||
        Date.parse(event.at) < Date.parse(current.attempt!.markedAt)) blocked("observation requires a marked attempt");
      next = { ...current, phase: event.outcome, observedAt: event.at };
      break;
  }
  const effects = [...journal.effects] as [RelayEffect, RelayEffect]; effects[index] = next;
  const fields = { ...body(journal), effects };
  return validateRelayEffectJournal({ ...fields, integrityHash: hashObject(fields) }, op);
}

export function relayRecoveryClass(journal: RelayEffectJournal, op: RelayUnsignedOperation):
  "not_started" | "observation_only" | "approval_confirmed" | "completed" | "failed" {
  validateRelayEffectJournal(journal, op);
  const [approval, deposit] = journal.effects;
  if (approval.phase === "failed" || deposit.phase === "failed") return "failed";
  if (deposit.phase === "confirmed") return "completed";
  if (deposit.phase !== "pending" || approval.phase === "submission_marked" || approval.phase === "tx_known") return "observation_only";
  return approval.phase === "confirmed" ? "approval_confirmed" : "not_started";
}

export class RelayEffectJournalRepository extends SecureStateStore {
  private readonly preparedOperations = new RelayUnsignedOperationRepository(this.root);
  private path(profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "Relay effect profile"); stateIdentifier(operationId, "Relay effect operation");
    return `relay-effect-journals/${profileHash}/${operationId}.json`;
  }
  private async operation(profileHash: string, operationId: string): Promise<RelayUnsignedOperation> {
    const op = await this.preparedOperations.loadOperation(profileHash, operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared Relay operation was not found.");
    return op;
  }
  async load(profileHash: string, operationId: string): Promise<RelayEffectJournal | null> {
    const op = await this.operation(profileHash, operationId);
    const value = await this.readJson(this.path(profileHash, operationId));
    return value === null ? null : validateRelayEffectJournal(value, op);
  }
  async create(profileHash: string, operationId: string, createdAt: string): Promise<RelayEffectJournal> {
    await this.initialize();
    return this.withLocks([`relay-effect:${profileHash}:${operationId}`], async () => {
      const op = await this.operation(profileHash, operationId);
      const path = this.path(profileHash, operationId);
      if (await this.readJson(path) !== null) blocked("journal already exists");
      const journal = createRelayEffectJournal(op, createdAt);
      await this.ensureDirectory(`relay-effect-journals/${profileHash}`);
      await this.writeJson(path, journal, true);
      return journal;
    });
  }
  async transition(profileHash: string, operationId: string, expectedIntegrityHash: string,
    event: RelayEffectEvent): Promise<RelayEffectJournal> {
    await this.initialize();
    return this.withLocks([`relay-effect:${profileHash}:${operationId}`], async () => {
      const op = await this.operation(profileHash, operationId);
      const path = this.path(profileHash, operationId);
      const value = await this.readJson(path);
      if (value === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay effect journal was not found.");
      const current = validateRelayEffectJournal(value, op);
      if (current.integrityHash !== expectedIntegrityHash) blocked("stale journal revision");
      const next = advanceRelayEffectJournal(current, op, event);
      await this.writeJson(path, next);
      return next;
    });
  }
}
