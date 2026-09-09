import { canonicalJson, hashObject } from "../../canonical.js";
import type { MetaMaskGaslessIntent, MetaMaskGaslessMutable } from "../model.js";
import { MM_ZERO_HASH } from "../model.js";
import { mmImmutable, mmMutable, MM_DISPATCH_RESERVE_BYTES, MM_DISPATCH_RESERVE_TRANSITIONS, MM_FILE_LIMIT,
  MM_HISTORY_LIMIT, MM_OPERATION_KIND, MM_OPERATION_VERSION, MM_TERMINAL,
  type MetaMaskGaslessOperationIdentity, type MetaMaskGaslessOperationRecord } from "../operation-model.js";
import { mmFail } from "../reasons.js";
import { mmExact, mmHash, mmIso, mmSame } from "../validation.js";
import { validateMetaMaskGaslessContinuity, validateMetaMaskGaslessOperation } from "./validation.js";

const PATCH_KEYS = ["state", "approval", "submissionAttempts", "dispatchStartedAt", "providerObservation",
  "cursor", "observation", "settlement", "failure"] as const;

function capacity(): never { return mmFail("mm_gasless_record_capacity"); }
function corrupt(): never { return mmFail("mm_gasless_state_corrupt"); }
function seal(value: Omit<MetaMaskGaslessOperationRecord, "integrityHash">): MetaMaskGaslessOperationRecord {
  return { ...value, integrityHash: hashObject(value) };
}
function assertFileLimit(operation: MetaMaskGaslessOperationRecord): void {
  if (Buffer.byteLength(canonicalJson(operation), "utf8") + 1 > MM_FILE_LIMIT) capacity();
}

export function newMetaMaskGaslessOperation(identityInput: MetaMaskGaslessOperationIdentity,
  intent: MetaMaskGaslessIntent): MetaMaskGaslessOperationRecord {
  const identity = mmExact(identityInput, ["profileHash", "operationId", "idempotencyHash", "requestHash"]);
  const profileHash = mmHash(identity.profileHash), operationId = mmHash(identity.operationId);
  const idempotencyHash = mmHash(identity.idempotencyHash), requestHash = mmHash(identity.requestHash);
  const immutable = { schemaVersion: MM_OPERATION_VERSION, kind: MM_OPERATION_KIND, profileHash, operationId,
    idempotencyHash, requestHash, createdAt: mmIso(intent.preparedAt), intent };
  const fingerprint = hashObject(mmImmutable(immutable));
  const mutable: MetaMaskGaslessMutable = { state: "awaiting_approval", approval: null, submissionAttempts: 0,
    dispatchStartedAt: null, providerObservation: null,
    cursor: { startBlock: intent.initialSnapshot.safeBlock, nextBlockAtomic: intent.initialSnapshot.safeBlock.numberAtomic,
      previousEndBlock: null }, observation: null, settlement: null, failure: null };
  const entry = { ...mutable, at: immutable.createdAt, previousHash: MM_ZERO_HASH };
  const operation = seal({ ...immutable, fingerprint, updatedAt: immutable.createdAt, terminal: false, ...mutable,
    transitions: [{ ...entry, transitionHash: hashObject(entry) }] });
  assertFileLimit(operation);
  return validateMetaMaskGaslessOperation(operation);
}

export function advanceMetaMaskGaslessOperation(operation: MetaMaskGaslessOperationRecord,
  patch: Partial<MetaMaskGaslessMutable>, atInput: string): MetaMaskGaslessOperationRecord {
  const current = validateMetaMaskGaslessOperation(operation), at = mmIso(atInput);
  if (Object.keys(patch).some(key => !PATCH_KEYS.includes(key as typeof PATCH_KEYS[number]))) corrupt();
  const nextMutable = { ...mmMutable(current), ...patch } as MetaMaskGaslessMutable;
  if (mmSame(mmMutable(current), nextMutable)) return current;
  if (current.terminal) corrupt();
  if (current.transitions.length >= MM_HISTORY_LIMIT) capacity();
  const entry = { ...nextMutable, at, previousHash: current.transitions.at(-1)!.transitionHash };
  const { integrityHash: _old, ...body } = current;
  const next = seal({ ...body, ...nextMutable, updatedAt: at, terminal: MM_TERMINAL.includes(nextMutable.state),
    transitions: [...current.transitions, { ...entry, transitionHash: hashObject(entry) }] });
  assertFileLimit(next);
  validateMetaMaskGaslessContinuity(current, next);
  return next;
}

export function metaMaskGaslessAtTransition(operation: MetaMaskGaslessOperationRecord,
  index: number): MetaMaskGaslessOperationRecord {
  const current = validateMetaMaskGaslessOperation(operation), entry = current.transitions[index];
  if (entry === undefined || !Number.isSafeInteger(index) || index < 0) corrupt();
  const { at, previousHash: _previous, transitionHash: _transition, ...snapshot } = entry;
  const { integrityHash: _old, ...body } = current;
  const historical = seal({ ...body, ...snapshot, updatedAt: at, terminal: MM_TERMINAL.includes(snapshot.state),
    transitions: current.transitions.slice(0, index + 1) });
  return validateMetaMaskGaslessOperation(historical);
}

export function assertMetaMaskGaslessDispatchCapacity(operation: MetaMaskGaslessOperationRecord): void {
  const current = validateMetaMaskGaslessOperation(operation);
  if (current.state !== "execution_pending" || current.submissionAttempts !== 0 || current.dispatchStartedAt !== null ||
    current.approval === null) corrupt();
  if (MM_HISTORY_LIMIT - current.transitions.length < MM_DISPATCH_RESERVE_TRANSITIONS ||
    Buffer.byteLength(canonicalJson(current), "utf8") + 1 + MM_DISPATCH_RESERVE_BYTES > MM_FILE_LIMIT) capacity();
}

/** Conservative pre-read gate; the exact resulting transition is still checked before persistence. */
export function assertMetaMaskGaslessObservationCapacity(operation: MetaMaskGaslessOperationRecord): void {
  const current = validateMetaMaskGaslessOperation(operation);
  if (current.submissionAttempts !== 1 || current.dispatchStartedAt === null || current.terminal) corrupt();
  if (current.transitions.length >= MM_HISTORY_LIMIT ||
    Buffer.byteLength(canonicalJson(current), "utf8") + 1 + MM_DISPATCH_RESERVE_BYTES > MM_FILE_LIMIT) capacity();
}
