import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import type { SmartAccountGaslessCursor, SmartAccountGaslessIntent, SmartAccountGaslessMaterialDescriptor,
  SmartAccountGaslessMutable, SmartAccountGaslessState } from "./model.js";
import { SA_FILE_LIMIT, SA_HISTORY_LIMIT, SA_MUTABLE_KEYS, SA_OPERATION_KIND, SA_OPERATION_VERSION,
  SA_TERMINAL, SA_TERMINAL_RESERVE_BYTES, SA_TERMINAL_RESERVE_TRANSITIONS, saImmutable, saMutable, saRequestHash,
  type SmartAccountGaslessOperationIdentity, type SmartAccountGaslessOperationRecord,
  type SmartAccountGaslessTransition } from "./operation-model.js";
import { saMaterialHash, saRequirementsHash, saSame } from "./integrity.js";
import { SA_REASON_CODES, saFail } from "./reasons.js";
import { saBlock, saBlockOrder, saCanonicalAddress, saExact, saHash, saHex, saIso, saStateCounters, saUint,
  validateSmartAccountGaslessIntent } from "./schema.js";

const TRANSITION_KEYS = ["at", "previousHash", ...SA_MUTABLE_KEYS, "transitionHash"] as const;
const OPERATION_KEYS = ["schemaVersion", "kind", "profileHash", "operationId", "idempotencyHash", "requestHash",
  "fingerprint", "createdAt", "updatedAt", "terminal", "intent", ...SA_MUTABLE_KEYS, "transitions", "integrityHash"] as const;
const EDGES: Readonly<Record<SmartAccountGaslessState, readonly SmartAccountGaslessState[]>> = {
  awaiting_approval: ["execution_pending", "failed_before_effect"],
  execution_pending: ["material_pending", "failed_before_effect"],
  material_pending: ["material_sealed", "failed_before_effect"],
  material_sealed: ["exposure_pending", "failed_before_effect"],
  exposure_pending: ["verified_pending", "unknown_finality", "completed", "expired_unused"],
  verified_pending: ["dispatch_pending", "unknown_finality", "completed", "expired_unused"],
  dispatch_pending: ["submitted_pending", "unknown_finality", "completed", "expired_unused"],
  submitted_pending: ["unknown_finality", "completed", "expired_unused"],
  unknown_finality: ["unknown_finality", "completed", "expired_unused"],
  failed_before_effect: [], completed: [], expired_unused: [],
};
const MATERIAL_HASH_KEYS = ["encodedRootHash", "encodedChildHash", "permissionContextHash", "payloadHash",
  "requirementsHash", "materialHash", "rootDelegationHash", "childDelegationHash"] as const;
function corrupt(): never { return saFail("sa_gasless_state_corrupt"); }
function capacity(): never { return saFail("sa_gasless_capacity"); }
function time(value: string): number { return Date.parse(value); }
function within(value: unknown, lower: string, upper: string): string {
  const result = saIso(value);
  if (time(result) < time(lower) || time(result) > time(upper)) corrupt();
  return result;
}
function fields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(SA_MUTABLE_KEYS.map(key => [key, value[key]]));
}
function hashes(value: Record<string, unknown>, names: readonly string[]): void {
  for (const key of names) saHash(value[key]);
}
function hashList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 8) corrupt();
  for (const hash of value) saHex(hash, 32);
  if (new Set(value).size !== value.length) corrupt();
  return value;
}
function cursorSchema(value: unknown, intent: SmartAccountGaslessIntent): SmartAccountGaslessCursor {
  const c = saExact(value, ["startBlock", "nextBlockAtomic", "previousEndBlock", "expiryBlock", "candidateHashes",
    "transferAnomalies", "childScanComplete", "transferScanComplete"]);
  const start = saBlock(c.startBlock), next = saUint(c.nextBlockAtomic);
  if (!saSame(start, intent.initialSnapshot.preparationBlock) || next < BigInt(start.numberAtomic)) corrupt();
  if (c.previousEndBlock === null) { if (next !== BigInt(start.numberAtomic)) corrupt(); }
  else {
    const end = saBlock(c.previousEndBlock); saBlockOrder(start, end);
    if (BigInt(end.numberAtomic) + 1n !== next) corrupt();
  }
  if (c.expiryBlock !== null) {
    const expiry = saBlock(c.expiryBlock); saBlockOrder(start, expiry);
    if (BigInt(expiry.timestampAtomic) < BigInt(intent.beforeUnix) || next > BigInt(expiry.numberAtomic) + 1n) corrupt();
    if (c.previousEndBlock !== null) saBlockOrder(saBlock(c.previousEndBlock), expiry);
  }
  hashList(c.candidateHashes); hashList(c.transferAnomalies);
  if (typeof c.childScanComplete !== "boolean" || typeof c.transferScanComplete !== "boolean") corrupt();
  if ((c.childScanComplete || c.transferScanComplete) && (c.expiryBlock === null ||
    next !== BigInt(saBlock(c.expiryBlock).numberAtomic) + 1n)) corrupt();
  return c as unknown as SmartAccountGaslessCursor;
}
function descriptor(value: unknown, intent: SmartAccountGaslessIntent, operationId: string,
  fingerprint: string, approvedAt: string, at: string): SmartAccountGaslessMaterialDescriptor {
  const d = saExact(value, [...MATERIAL_HASH_KEYS, "sealedAt"]);
  hashes(d, MATERIAL_HASH_KEYS.slice(0, 6)); saHex(d.rootDelegationHash, 32); saHex(d.childDelegationHash, 32);
  const sealedAt = within(d.sealedAt, approvedAt, at);
  if (d.encodedRootHash !== intent.binding.encodedRootHash ||
    d.rootDelegationHash !== intent.binding.rootDelegationHash || d.rootDelegationHash === d.childDelegationHash ||
    d.requirementsHash !== saRequirementsHash(intent.requirements)) corrupt();
  const { sealedAt: _at, materialHash, ...rest } = d;
  if (materialHash !== saMaterialHash(operationId, fingerprint,
    rest as unknown as Omit<SmartAccountGaslessMaterialDescriptor, "materialHash" | "sealedAt">)) corrupt();
  return d as unknown as SmartAccountGaslessMaterialDescriptor;
}
function proofFields(m: Record<string, unknown>, intent: SmartAccountGaslessIntent,
  material: SmartAccountGaslessMaterialDescriptor | null, cursor: SmartAccountGaslessCursor, lower: string, at: string): void {
  if (m.settlement !== null) {
    if (material === null || m.state !== "completed" || m.unusedProof !== null) corrupt();
    const s = saExact(m.settlement, ["observedAt", "source", "txHash", "transactionBlock", "finalityBlock", "finality",
      "outerSender", "transactionProofHash", "receiptHash", "contextHash", "protocolHash", "rootDelegationHash",
      "childDelegationHash", "childSpentAtomic", "debitAtomic", "deliveredAtomic", "feeAtomic", "refundAtomic",
      "unusedGrossAtomic", "ownerNativeDebitWei", "sessionNativeDebitWei"]);
    const observedAt = within(s.observedAt, lower, at), tx = saBlock(s.transactionBlock), head = saBlock(s.finalityBlock);
    saBlockOrder(cursor.startBlock, tx); saBlockOrder(tx, head); saHex(s.txHash, 32);
    hashes(s, ["transactionProofHash", "receiptHash", "contextHash", "protocolHash"]);
    if ((s.source !== "rpc_discovered" && s.source !== "provider_hint") ||
      (s.finality !== "safe" && s.finality !== "finalized") ||
      !intent.provider.facilitatorAddresses.includes(saCanonicalAddress(s.outerSender)) ||
      s.rootDelegationHash !== material.rootDelegationHash || s.childDelegationHash !== material.childDelegationHash ||
      s.contextHash !== material.permissionContextHash || BigInt(tx.timestampAtomic) <= BigInt(intent.afterUnix) ||
      BigInt(tx.timestampAtomic) >= BigInt(intent.beforeUnix) || BigInt(head.timestampAtomic) * 1000n > BigInt(time(observedAt))) corrupt();
    if (s.source === "provider_hint" && (m.submissionAttempts !== 1 || m.providerSettlement === null ||
      (m.providerSettlement as { transactionHash: unknown }).transactionHash !== s.txHash)) corrupt();
    for (const key of ["childSpentAtomic", "debitAtomic", "deliveredAtomic"]) if (s[key] !== intent.request.grossAtomic) corrupt();
    for (const key of ["feeAtomic", "refundAtomic", "unusedGrossAtomic", "ownerNativeDebitWei", "sessionNativeDebitWei"])
      if (s[key] !== "0") corrupt();
  } else if (m.state === "completed") corrupt();
  if (m.unusedProof !== null) {
    if (material === null || m.state !== "expired_unused" || m.settlement !== null) corrupt();
    const p = saExact(m.unusedProof, ["observedAt", "startBlock", "expiryBlock", "finalityBlock", "childDelegationHash",
      "childSpentAtomic", "childScanHash", "transferScanHash", "anchorsHash", "protocolHash"]);
    const observedAt = within(p.observedAt, lower, at), start = saBlock(p.startBlock);
    const expiry = saBlock(p.expiryBlock), head = saBlock(p.finalityBlock);
    saBlockOrder(start, expiry); saBlockOrder(expiry, head);
    hashes(p, ["childScanHash", "transferScanHash", "anchorsHash", "protocolHash"]);
    if (!saSame(start, cursor.startBlock) || !saSame(expiry, cursor.expiryBlock) ||
      BigInt(head.timestampAtomic) * 1000n > BigInt(time(observedAt)) ||
      BigInt(expiry.timestampAtomic) < BigInt(intent.beforeUnix) || p.childDelegationHash !== material.childDelegationHash ||
      p.childSpentAtomic !== "0" || !cursor.childScanComplete || !cursor.transferScanComplete ||
      cursor.candidateHashes.length !== 0 || cursor.transferAnomalies.length !== 0) corrupt();
  } else if (m.state === "expired_unused") corrupt();
}
function journalMutable(value: unknown, intent: SmartAccountGaslessIntent, operationId: string,
  fingerprint: string, at: string): SmartAccountGaslessMutable {
  const m = saExact(value, SA_MUTABLE_KEYS);
  saStateCounters({ state: m.state, signingAttempts: m.signingAttempts, exposureAttempts: m.exposureAttempts,
    submissionAttempts: m.submissionAttempts });
  if (m.state === "material_pending" && time(at) >= time(intent.expiresAt)) corrupt();
  let approvedAt: string | null = null;
  if (m.approval !== null) {
    const a = saExact(m.approval, ["fingerprint", "approvedAt", "expiresAt"]);
    approvedAt = within(a.approvedAt, intent.preparedAt, at);
    if (a.fingerprint !== fingerprint || a.expiresAt !== intent.expiresAt || time(approvedAt) >= time(intent.expiresAt)) corrupt();
  }
  if ((m.state === "awaiting_approval" && approvedAt !== null) ||
    (approvedAt === null && m.state !== "awaiting_approval" && m.state !== "failed_before_effect") ||
    (approvedAt === null && m.signingAttempts !== 0)) corrupt();
  const material = m.material === null ? null : descriptor(m.material, intent, operationId, fingerprint, approvedAt!, at);
  if ((m.signingAttempts === 0 && material !== null) || (m.state === "material_pending" && material !== null) ||
    (material === null && (m.state === "material_sealed" || m.exposureAttempts === 1))) corrupt();
  let exposedAt: string | null = null, dispatchAt: string | null = null;
  if (m.exposureAttempts === 0) { if (m.exposureStartedAt !== null) corrupt(); }
  else {
    exposedAt = within(m.exposureStartedAt, material!.sealedAt, at);
    if (time(exposedAt) >= time(intent.expiresAt)) corrupt();
  }
  if (m.verification !== null) {
    const v = saExact(m.verification, ["observedAt", "payer", "isValid", "responseHash"]);
    if (exposedAt === null || v.isValid !== true || saCanonicalAddress(v.payer) !== intent.binding.ownerAddress) corrupt();
    within(v.observedAt, exposedAt, at); saHash(v.responseHash);
  }
  if (m.submissionAttempts === 0) { if (m.dispatchStartedAt !== null || m.providerSettlement !== null) corrupt(); }
  else {
    if (m.verification === null) corrupt();
    dispatchAt = within(m.dispatchStartedAt, (m.verification as { observedAt: string }).observedAt, at);
    if (time(dispatchAt) >= time(intent.expiresAt)) corrupt();
  }
  if ((m.state === "verified_pending" && m.verification === null) ||
    (m.state === "exposure_pending" && m.verification !== null)) corrupt();
  if (m.providerSettlement !== null) {
    const p = saExact(m.providerSettlement, ["observedAt", "transactionHash", "responseHash"]);
    if (dispatchAt === null) corrupt();
    within(p.observedAt, dispatchAt, at); saHash(p.responseHash);
    if (p.transactionHash !== null) saHex(p.transactionHash, 32);
  } else if (m.state === "submitted_pending") corrupt();
  if (m.observation !== null) {
    const sourced = typeof m.observation === "object" && m.observation !== null && Object.hasOwn(m.observation, "source");
    const o = saExact(m.observation, ["observedAt", "phase", "reason", "candidateTxHash", "evidenceHash", ...(sourced ? ["source"] : [])]);
    if (sourced) {
      const s = saExact(o.source, ["environmentName", "endpointOrigin", "endpointHash"]);
      if (typeof s.environmentName !== "string" || s.environmentName.length > 128 || !/^APN_[A-Z0-9_]+_RPC_URL$/u.test(s.environmentName) ||
        typeof s.endpointOrigin !== "string" || s.endpointOrigin.length > 256 || !/^https:\/\/[^/?#]+$/u.test(s.endpointOrigin)) corrupt();
      saHash(s.endpointHash);
    }
    if (exposedAt === null || !["pending", "unavailable", "invalid", "reorg", "success", "expired_unused"].includes(o.phase as string)) corrupt();
    within(o.observedAt, exposedAt, at);
    if (o.reason !== null && (typeof o.reason !== "string" || !Object.hasOwn(SA_REASON_CODES, o.reason))) corrupt();
    if (o.candidateTxHash !== null) saHex(o.candidateTxHash, 32);
    if (o.evidenceHash !== null) saHash(o.evidenceHash);
    if ((o.phase === "success") !== (m.state === "completed") ||
      (o.phase === "expired_unused") !== (m.state === "expired_unused")) corrupt();
    if ((m.state === "completed" || m.state === "expired_unused") && (o.reason !== null || o.evidenceHash === null)) corrupt();
  } else if (m.state === "completed" || m.state === "expired_unused") corrupt();
  const cursor = cursorSchema(m.cursor, intent);
  if (m.exposureAttempts === 0 && !saSame(cursor, initialMutable(intent).cursor)) corrupt();
  proofFields(m, intent, material, cursor, exposedAt ?? intent.preparedAt, at);
  if (m.settlement !== null && (m.observation as { candidateTxHash: unknown }).candidateTxHash !==
    (m.settlement as { txHash: unknown }).txHash) corrupt();
  if (m.failure !== null) {
    const f = saExact(m.failure, ["code", "reason"]);
    if (typeof f.reason !== "string" || !Object.hasOwn(SA_REASON_CODES, f.reason) ||
      f.code !== SA_REASON_CODES[f.reason as keyof typeof SA_REASON_CODES]) corrupt();
  }
  if ((m.state === "failed_before_effect" || m.state === "unknown_finality") && m.failure === null) corrupt();
  if (m.state !== "failed_before_effect" && m.state !== "unknown_finality" && m.failure !== null) corrupt();
  return m as unknown as SmartAccountGaslessMutable;
}
function initialMutable(intent: SmartAccountGaslessIntent): SmartAccountGaslessMutable {
  return { state: "awaiting_approval", approval: null, material: null, signingAttempts: 0, exposureAttempts: 0,
    submissionAttempts: 0, exposureStartedAt: null, dispatchStartedAt: null, verification: null, providerSettlement: null,
    cursor: { startBlock: intent.initialSnapshot.preparationBlock, nextBlockAtomic: intent.initialSnapshot.preparationBlock.numberAtomic,
      previousEndBlock: null, expiryBlock: null, candidateHashes: [], transferAnomalies: [], childScanComplete: false,
      transferScanComplete: false }, observation: null, settlement: null, unusedProof: null, failure: null };
}
function step(previous: SmartAccountGaslessTransition, next: SmartAccountGaslessTransition): void {
  if (!EDGES[previous.state].includes(next.state) || time(next.at) < time(previous.at)) corrupt();
  const once = ["approval", "material", "verification", "providerSettlement"] as const;
  const stages = { approval: ["awaiting_approval", "execution_pending"], material: ["material_pending", "material_sealed"],
    verification: ["exposure_pending", "verified_pending"], providerSettlement: ["dispatch_pending", "submitted_pending"] } as const;
  for (const key of once) {
    if (previous[key] !== null && !saSame(previous[key], next[key])) corrupt();
    if (previous[key] === null && next[key] !== null &&
      (previous.state !== stages[key][0] || next.state !== stages[key][1])) corrupt();
  }
  if (previous.approval === null && next.approval !== null && next.approval.approvedAt !== next.at) corrupt();
  if (previous.material === null && next.material !== null && time(next.material.sealedAt) < time(previous.at)) corrupt();
  const markers = { signingAttempts: ["execution_pending", "material_pending"],
    exposureAttempts: ["material_sealed", "exposure_pending"], submissionAttempts: ["verified_pending", "dispatch_pending"] } as const;
  for (const key of ["signingAttempts", "exposureAttempts", "submissionAttempts"] as const) {
    if (previous[key] > next[key] || (previous[key] === 0 && next[key] === 1 &&
      (previous.state !== markers[key][0] || next.state !== markers[key][1]))) corrupt();
  }
  for (const [counter, marker] of [["exposureAttempts", "exposureStartedAt"], ["submissionAttempts", "dispatchStartedAt"]] as const) {
    if ((previous[counter] === 0 && next[counter] === 1 && next[marker] !== next.at) ||
      (previous[counter] === 1 && previous[marker] !== next[marker])) corrupt();
  }
  if (previous.observation !== null && (next.observation === null ||
    time(next.observation.observedAt) < time(previous.observation.observedAt))) corrupt();
  const p = previous.cursor, n = next.cursor, before = BigInt(p.nextBlockAtomic), after = BigInt(n.nextBlockAtomic);
  if (after < before || !saSame(p.startBlock, n.startBlock) ||
    (after === before && !saSame(p.previousEndBlock, n.previousEndBlock)) ||
    (p.expiryBlock !== null && !saSame(p.expiryBlock, n.expiryBlock))) corrupt();
  if (p.previousEndBlock !== null && n.previousEndBlock !== null) saBlockOrder(p.previousEndBlock, n.previousEndBlock);
  for (const key of ["candidateHashes", "transferAnomalies"] as const)
    if (!saSame(p[key], n[key].slice(0, p[key].length))) corrupt();
  for (const key of ["childScanComplete", "transferScanComplete"] as const) if (p[key] && !n[key]) corrupt();
  if (!saSame(p, n) && (next.observation === null || previous.exposureAttempts !== 1)) corrupt();
}
function seal(body: Omit<SmartAccountGaslessOperationRecord, "integrityHash">): SmartAccountGaslessOperationRecord {
  return { ...body, integrityHash: hashObject(body) };
}
function byteLength(value: unknown): number { return Buffer.byteLength(canonicalJson(value), "utf8") + 1; }
function validate(value: unknown): SmartAccountGaslessOperationRecord {
  if (byteLength(value) > SA_FILE_LIMIT) corrupt();
  const r = saExact(value, OPERATION_KEYS);
  if (r.schemaVersion !== SA_OPERATION_VERSION || r.kind !== SA_OPERATION_KIND || typeof r.terminal !== "boolean") corrupt();
  hashes(r, ["profileHash", "operationId", "idempotencyHash", "requestHash", "fingerprint", "integrityHash"]);
  const intent = validateSmartAccountGaslessIntent(r.intent), createdAt = saIso(r.createdAt), updatedAt = saIso(r.updatedAt);
  const profileHash = r.profileHash as string, operationId = r.operationId as string, fingerprint = r.fingerprint as string;
  if (profileHash !== sha256(`profile\0${intent.profile}`) || createdAt !== intent.preparedAt || time(updatedAt) < time(createdAt)) corrupt();
  const immutable = { schemaVersion: SA_OPERATION_VERSION, kind: SA_OPERATION_KIND, profileHash, operationId,
    idempotencyHash: r.idempotencyHash as string, requestHash: r.requestHash as string, createdAt, intent };
  if (fingerprint !== hashObject(saImmutable(immutable)) || r.requestHash !== saRequestHash(profileHash, intent) ||
    !Array.isArray(r.transitions) || r.transitions.length < 1 || r.transitions.length > SA_HISTORY_LIMIT) corrupt();
  const transitions: SmartAccountGaslessTransition[] = [];
  for (const raw of r.transitions) {
    const t = saExact(raw, TRANSITION_KEYS), at = saIso(t.at), previousHash = saHash(t.previousHash);
    const transitionHash = saHash(t.transitionHash), { transitionHash: _hash, ...body } = t;
    if (hashObject(body) !== transitionHash) corrupt();
    const current = { ...journalMutable(fields(t), intent, operationId, fingerprint, at), at, previousHash, transitionHash };
    const prior = transitions.at(-1);
    if (prior === undefined) {
      if (previousHash !== fingerprint || at !== createdAt || !saSame(saMutable(current), initialMutable(intent))) corrupt();
    } else { if (previousHash !== prior.transitionHash) corrupt(); step(prior, current); }
    transitions.push(current);
  }
  const current = journalMutable(fields(r), intent, operationId, fingerprint, updatedAt), last = transitions.at(-1)!;
  if (last.at !== updatedAt || !saSame(saMutable(last), current) || r.terminal !== SA_TERMINAL.includes(current.state)) corrupt();
  const operation = { ...immutable, fingerprint, updatedAt, terminal: r.terminal, ...current, transitions,
    integrityHash: r.integrityHash as string };
  const { integrityHash, ...body } = operation;
  if (integrityHash !== hashObject(body)) corrupt();
  return operation;
}
export function validateSmartAccountGaslessOperation(value: unknown): SmartAccountGaslessOperationRecord {
  try { return validate(value); } catch { return corrupt(); }
}
export function validateSmartAccountGaslessContinuity(previous: SmartAccountGaslessOperationRecord,
  next: SmartAccountGaslessOperationRecord): void {
  const before = validateSmartAccountGaslessOperation(previous), after = validateSmartAccountGaslessOperation(next);
  if (saSame(before, after)) return;
  if (before.terminal || before.fingerprint !== after.fingerprint || !saSame(saImmutable(before), saImmutable(after)) ||
    after.transitions.length !== before.transitions.length + 1 || !saSame(before.transitions, after.transitions.slice(0, -1))) corrupt();
}
export function newSmartAccountGaslessOperation(identityInput: SmartAccountGaslessOperationIdentity,
  intent: SmartAccountGaslessIntent): SmartAccountGaslessOperationRecord {
  const identity = saExact(identityInput, ["profileHash", "operationId", "idempotencyHash", "requestHash"]);
  hashes(identity, Object.keys(identity));
  const immutable = saImmutable({ ...identityInput, intent, createdAt: saIso(intent.preparedAt) });
  const fingerprint = hashObject(immutable), mutable = initialMutable(intent);
  const entry = { ...mutable, at: immutable.createdAt, previousHash: fingerprint };
  return validateSmartAccountGaslessOperation(seal({ ...immutable, fingerprint, updatedAt: immutable.createdAt,
    terminal: false, ...mutable, transitions: [{ ...entry, transitionHash: hashObject(entry) }] }));
}
function sameObservation(first: SmartAccountGaslessMutable, second: SmartAccountGaslessMutable): boolean {
  const clean = (value: SmartAccountGaslessMutable) => ({ ...value,
    observation: value.observation === null ? null : { ...value.observation, observedAt: null } });
  return saSame(clean(first), clean(second));
}
export function advanceSmartAccountGaslessOperation(operation: SmartAccountGaslessOperationRecord,
  patch: Partial<SmartAccountGaslessMutable>, atInput: string): SmartAccountGaslessOperationRecord {
  const current = validateSmartAccountGaslessOperation(operation), at = saIso(atInput);
  if (time(at) < time(current.updatedAt) || Object.keys(patch).some(key => !SA_MUTABLE_KEYS.includes(key as typeof SA_MUTABLE_KEYS[number]))) corrupt();
  const mutable = { ...saMutable(current), ...patch };
  if (saSame(saMutable(current), mutable)) return current;
  if (current.terminal) corrupt();
  journalMutable(mutable, current.intent, current.operationId, current.fingerprint, at);
  if (current.observation !== null && mutable.observation !== null &&
    time(mutable.observation.observedAt) < time(current.observation.observedAt)) corrupt();
  if (sameObservation(saMutable(current), mutable)) return current;
  const terminal = SA_TERMINAL.includes(mutable.state), entry = { ...mutable, at, previousHash: current.transitions.at(-1)!.transitionHash };
  const { integrityHash: _old, ...body } = current;
  const next = seal({ ...body, ...mutable, updatedAt: at, terminal,
    transitions: [...current.transitions, { ...entry, transitionHash: hashObject(entry) }] });
  if (next.transitions.length > SA_HISTORY_LIMIT || byteLength(next) > SA_FILE_LIMIT ||
    (!terminal && (next.transitions.length > SA_HISTORY_LIMIT - SA_TERMINAL_RESERVE_TRANSITIONS ||
      byteLength(next) > SA_FILE_LIMIT - SA_TERMINAL_RESERVE_BYTES))) capacity();
  validateSmartAccountGaslessContinuity(current, next);
  return next;
}
export function smartAccountGaslessAtTransition(operation: SmartAccountGaslessOperationRecord, index: number): SmartAccountGaslessOperationRecord {
  const current = validateSmartAccountGaslessOperation(operation), entry = current.transitions[index];
  if (!Number.isSafeInteger(index) || index < 0 || entry === undefined) corrupt();
  const { at, previousHash: _previous, transitionHash: _hash, ...snapshot } = entry;
  const { integrityHash: _old, ...body } = current;
  return validateSmartAccountGaslessOperation(seal({ ...body, ...snapshot, updatedAt: at,
    terminal: SA_TERMINAL.includes(snapshot.state), transitions: current.transitions.slice(0, index + 1) }));
}
/** Reserve two proof-bearing terminal events without letting a transient read erase a live guard. */
export function assertSmartAccountGaslessCapacity(operation: SmartAccountGaslessOperationRecord): void {
  const op = validateSmartAccountGaslessOperation(operation);
  if (op.terminal) corrupt();
  if (op.transitions.length >= SA_HISTORY_LIMIT - SA_TERMINAL_RESERVE_TRANSITIONS ||
    byteLength(op) > SA_FILE_LIMIT - SA_TERMINAL_RESERVE_BYTES) capacity();
}
