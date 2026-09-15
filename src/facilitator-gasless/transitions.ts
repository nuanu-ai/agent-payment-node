import { canonicalJson, hashObject } from "../canonical.js";
import { GASLESS_TTL_MS } from "../gasless/validation.js";
import { facilitatorFail } from "./failure.js";
import { FACILITATOR_FILE_LIMIT, FACILITATOR_HISTORY_LIMIT, FACILITATOR_INITIAL, FACILITATOR_KIND, FACILITATOR_OPERATION_VERSION,
  FACILITATOR_POLICY, FACILITATOR_TERMINAL, facilitatorBinding, facilitatorMutable, sealFacilitatorOperation,
  type FacilitatorExchange, type FacilitatorIntent, type FacilitatorMutable, type FacilitatorOperationRecord,
  type FacilitatorState } from "./operation-model.js";
import { facilitatorAuthorizationDigest, facilitatorRequirement, facilitatorRequirementHash } from "./requirement.js";
import { facilitatorOperationSchema } from "./schema.js";

const NEXT: Readonly<Record<FacilitatorState, readonly FacilitatorState[]>> = {
  awaiting_approval: ["approved", "failed_before_effect"],
  approved: ["verify_started", "failed_before_effect"],
  verify_started: ["verify_started", "settle_started", "completed", "expired_unused", "abandoned_unknown"],
  settle_started: ["settle_started", "settle_submitted", "completed", "expired_unused", "abandoned_unknown"],
  settle_submitted: ["settle_submitted", "completed", "expired_unused", "abandoned_unknown"],
  completed: [], expired_unused: [], failed_before_effect: [], abandoned_unknown: [],
};

export function facilitatorSame(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function corrupt(): never { return facilitatorFail("facilitator_gasless_state_corrupt"); }
function attempt<T>(work: () => T): T { try { return work(); } catch { return corrupt(); } }

export function newFacilitatorOperation(input: { readonly profileHash: string; readonly operationId: string;
  readonly idempotencyHash: string; readonly requestHash: string; readonly intent: FacilitatorIntent }): FacilitatorOperationRecord {
  const immutable = { schemaVersion: FACILITATOR_OPERATION_VERSION, kind: FACILITATOR_KIND, ...input };
  const fingerprint = hashObject(facilitatorBinding(immutable));
  const entry = { ...FACILITATOR_INITIAL, at: input.intent.preparedAt, previousHash: fingerprint };
  return validateFacilitatorOperation(sealFacilitatorOperation({ ...immutable, ...FACILITATOR_INITIAL, fingerprint,
    createdAt: input.intent.preparedAt, updatedAt: input.intent.preparedAt, terminal: false,
    transitions: [{ ...entry, transitionHash: hashObject(entry) }] }));
}

export function transitionFacilitator(op: FacilitatorOperationRecord, patch: Partial<FacilitatorMutable>, at: string): FacilitatorOperationRecord {
  validateFacilitatorOperation(op);
  const mutable = facilitatorMutable({ ...facilitatorMutable(op), ...patch });
  if (facilitatorSame(facilitatorMutable(op), mutable)) return op;
  const terminal = FACILITATOR_TERMINAL.includes(mutable.state);
  if (op.transitions.length >= FACILITATOR_HISTORY_LIMIT - (terminal ? 0 : 2)) {
    // The last entries stay reserved for a terminal proof; a repeated non-terminal note is dropped instead.
    if (!terminal && mutable.state === op.state) return op;
    facilitatorFail("facilitator_gasless_capacity");
  }
  const entry = { ...mutable, at, previousHash: op.transitions.at(-1)!.transitionHash };
  const { integrityHash: _old, ...body } = op;
  const next = sealFacilitatorOperation({ ...body, ...mutable, updatedAt: at, terminal,
    transitions: [...op.transitions, { ...entry, transitionHash: hashObject(entry) }] });
  if (Buffer.byteLength(canonicalJson(next), "utf8") + 1 > FACILITATOR_FILE_LIMIT) facilitatorFail("facilitator_gasless_capacity");
  validateFacilitatorOperation(next);
  validateFacilitatorContinuity(op, next);
  return next;
}

export function facilitatorAtTransition(op: FacilitatorOperationRecord, index: number): FacilitatorOperationRecord {
  const step = op.transitions[index];
  if (step === undefined) corrupt();
  const { at, previousHash: _previous, transitionHash: _transition, ...mutable } = step;
  const { integrityHash: _old, ...body } = op;
  return sealFacilitatorOperation({ ...body, ...mutable, updatedAt: at, terminal: FACILITATOR_TERMINAL.includes(mutable.state),
    transitions: op.transitions.slice(0, index + 1) });
}

export function validateFacilitatorOperation(value: unknown): FacilitatorOperationRecord {
  const parsed = facilitatorOperationSchema.safeParse(value);
  if (!parsed.success) corrupt();
  const op = parsed.data as unknown as FacilitatorOperationRecord;
  const { integrityHash, ...body } = op;
  if (hashObject(body) !== integrityHash || hashObject(facilitatorBinding(op)) !== op.fingerprint) corrupt();
  validIntent(op.intent);
  if (op.createdAt !== op.intent.preparedAt || op.transitions[0]!.at !== op.intent.preparedAt ||
    op.updatedAt !== op.transitions.at(-1)!.at || op.terminal !== FACILITATOR_TERMINAL.includes(op.state)) corrupt();
  let previous: FacilitatorMutable | null = null, link = op.fingerprint;
  for (const step of op.transitions) {
    const { at, previousHash, transitionHash, ...mutable } = step;
    if (previousHash !== link || hashObject({ ...mutable, at, previousHash }) !== transitionHash) corrupt();
    if (previous === null ? !facilitatorSame(mutable, FACILITATOR_INITIAL) : !validStep(previous, mutable)) corrupt();
    validShape(op, mutable);
    previous = mutable; link = transitionHash;
  }
  if (!facilitatorSame(previous, facilitatorMutable(op))) corrupt();
  return op;
}

export function validateFacilitatorContinuity(previous: FacilitatorOperationRecord, next: FacilitatorOperationRecord): void {
  if (!facilitatorSame(facilitatorBinding(previous), facilitatorBinding(next)) || previous.fingerprint !== next.fingerprint ||
    next.transitions.length < previous.transitions.length ||
    !facilitatorSame(previous.transitions, next.transitions.slice(0, previous.transitions.length))) corrupt();
}

function validIntent(i: FacilitatorIntent): void {
  const gross = BigInt(i.request.grossAtomic), minimum = BigInt(i.request.minReceivedAtomic);
  const requirement = attempt(() => facilitatorRequirement(i.request.recipient.toLowerCase(), i.request.grossAtomic));
  if (i.owner.profile !== i.profile || gross === 0n || minimum === 0n || minimum > gross || BigInt(i.initial.balanceAtomic) < gross ||
    i.request.recipient.toLowerCase() === i.owner.address.toLowerCase() || !facilitatorSame(i.requirement, requirement) ||
    i.requirementHash !== facilitatorRequirementHash(i.requirement) || Date.parse(i.expiresAt) - Date.parse(i.preparedAt) !== GASLESS_TTL_MS ||
    i.policyHash !== hashObject({ identity: FACILITATOR_POLICY, request: i.request })) corrupt();
}

/** Each state carries exactly the facts that have happened; exposure facts never exist before their marker. */
function validShape(op: FacilitatorOperationRecord, m: FacilitatorMutable): void {
  const signed = m.signed, sealed = signed !== null && signed.signatureHash !== null;
  const untouched = m.verify === null && m.settle === null && m.observation === null && m.settlement === null;
  const expired = signed !== null && m.observation !== null && !m.observation.authorizationUsed &&
    BigInt(m.observation.finalized.timestampAtomic) >= BigInt(signed.authorization.validBefore);
  const shape: Readonly<Record<FacilitatorState, boolean>> = {
    awaiting_approval: m.approval === null && signed === null && untouched,
    approved: m.approval !== null && signed !== null && !sealed && untouched,
    verify_started: sealed && m.verify !== null && m.settle === null && m.settlement === null,
    settle_started: sealed && m.verify?.outcome === "accepted" && m.settle !== null && m.settle.transactionHash === null && m.settlement === null,
    settle_submitted: sealed && m.verify?.outcome === "accepted" && m.settle !== null && m.settle.transactionHash !== null && m.settlement === null,
    completed: sealed && m.verify !== null && m.settlement !== null,
    expired_unused: sealed && m.verify !== null && m.settlement === null && expired,
    failed_before_effect: untouched && !sealed && (m.approval === null) === (signed === null),
    abandoned_unknown: sealed && m.verify !== null && m.settlement === null,
  };
  if (!shape[m.state]) corrupt();
  if (m.approval !== null && (m.approval.fingerprint !== op.fingerprint || m.approval.expiresAt !== op.intent.expiresAt)) corrupt();
  if (signed !== null) {
    const a = signed.authorization;
    if (a.from !== op.intent.owner.address.toLowerCase() || a.to !== op.intent.requirement.payTo ||
      a.value !== op.intent.requirement.amount || signed.digest !== attempt(() => facilitatorAuthorizationDigest(a))) corrupt();
  }
  if (m.verify !== null && (m.verify.transactionHash !== null || m.verify.outcome === "pending")) corrupt();
  if (m.settle !== null && m.settle.transactionHash !== null && m.settle.outcome !== "accepted" && m.settle.outcome !== "pending") corrupt();
  if (m.settlement !== null && m.settlement.deliveredAtomic !== op.intent.request.grossAtomic) corrupt();
}

function validStep(p: FacilitatorMutable, n: FacilitatorMutable): boolean {
  if (!NEXT[p.state].includes(n.state)) return false;
  if (p.approval !== null && !facilitatorSame(p.approval, n.approval)) return false;
  if (p.signed !== null && (n.signed === null || !facilitatorSame({ ...p.signed, signatureHash: null }, { ...n.signed, signatureHash: null }) ||
    (p.signed.signatureHash !== null && p.signed.signatureHash !== n.signed.signatureHash))) return false;
  return keeps(p.verify, n.verify) && keeps(p.settle, n.settle) && (p.observation === null || n.observation !== null);
}

/** A started exchange is never removed, and a recorded outcome never changes. */
function keeps(p: FacilitatorExchange | null, n: FacilitatorExchange | null): boolean {
  if (p === null) return true;
  if (n === null || p.startedAt !== n.startedAt) return false;
  return p.outcome === "unknown" || facilitatorSame(p, n);
}
