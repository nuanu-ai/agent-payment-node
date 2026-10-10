import { FIRST_SEND_POLICY, FIRST_SEND_TTL_MS as TTL_MS, firstSendApprovalSchema, type GaslessFirstSendApproval } from "./first-send-model.js";
export type { GaslessFirstSendApproval } from "./first-send-model.js";
import { hashObject } from "../canonical.js";
import type { GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
import type { GaslessApprovalPort } from "./ports.js";
import { publicGaslessOperation } from "./receipt.js";
import { gaslessPolicyChain } from "./asset-policy.js";
import { gaslessDeployment } from "./registry.js";
import { gaslessFailure, gaslessSame } from "./validation.js";

/** Only this exact first final effect can acquire fresh local consent. */
export function assertSealedFirstSend(op: GaslessOperationRecord | (Pick<GaslessOperationRecord, "intent"> & GaslessMutable)): void {
  const b = op.bootstrap, u = op.userOperation;
  if (gaslessPolicyChain(op.intent.request.chainId) === null || op.intent.allowlist === undefined ||
    op.intent.token !== gaslessDeployment(op.intent.request.chainId).token || op.state !== "unknown_finality" ||
    b.phase !== "checked" || b.signingAttempts !== 1 || b.disclosureAttempts !== 1 || b.submissionAttempts !== 0 ||
    b.materialHash === null || b.estimate === null || b.sealedAt === null ||
    u.phase !== "sealed" || u.signingAttempts !== 1 || u.disclosureAttempts !== 0 || u.submissionAttempts !== 0 ||
    u.materialHash === null || u.userOperationHash === null || u.sealedAt === null ||
    op.settlement !== null || op.observation?.transactionHash != null || op.observation?.settlement != null) refused();
}
function binding(op: GaslessOperationRecord | (Pick<GaslessOperationRecord,
  "intent" | "operationId" | "fingerprint" | "profileHash"> & GaslessMutable)) {
  const a = op.intent.allowlist;
  if (a === undefined || op.bootstrap.materialHash === null || op.bootstrap.estimate === null ||
    op.userOperation.materialHash === null || op.userOperation.userOperationHash === null) refused();
  return { policy: FIRST_SEND_POLICY, operationId: op.operationId, operationFingerprint: op.fingerprint,
    profileHash: op.profileHash, envelopeHash: op.intent.unsignedEnvelopeHash,
    bootstrapMaterialHash: op.bootstrap.materialHash, bootstrapEstimateHash: hashObject(op.bootstrap.estimate),
    userOperationMaterialHash: op.userOperation.materialHash, userOperationHash: op.userOperation.userOperationHash,
    owner: op.intent.owner.address, reservationId: a.reservationId, policyDigest: a.policyDigest,
    policyRevision: a.policyRevision, activationDigest: a.activationDigest };
}
export function validateFirstSendApprovals(op: GaslessOperationRecord, s: GaslessMutable, at: string): void {
  let previous = op.createdAt;
  for (const entry of s.firstSendApprovals ?? []) {
    if (!firstSendApprovalSchema.safeParse(entry).success) refused();
    const { approvalDigest, approvalFingerprint, approvedAt, issuedAt, expiresAt, ...bound } = entry;
    const draft = { ...bound, issuedAt, expiresAt };
    if (!gaslessSame(bound, binding({ ...op, ...s })) || approvalFingerprint !== hashObject(draft) ||
      approvalDigest !== hashObject({ ...draft, approvedAt, approvalFingerprint }) ||
      issuedAt < op.intent.expiresAt || issuedAt < previous || approvedAt < issuedAt || approvedAt >= expiresAt ||
      approvedAt > at || Date.parse(expiresAt) - Date.parse(issuedAt) !== TTL_MS) refused();
    previous = approvedAt;
  }
}
export function assertLateFirstSend(op: GaslessOperationRecord, s: GaslessMutable, submittedAt: string): void {
  const a = s.firstSendApprovals?.at(-1);
  if (a === undefined || submittedAt < a.approvedAt || submittedAt >= a.expiresAt ||
    s.bootstrap.disclosureAttempts !== 1 || s.userOperation.signingAttempts !== 1 ||
    s.userOperation.disclosureAttempts !== 0 || s.userOperation.submissionAttempts !== 1 ||
    !gaslessSame(binding({ ...op, ...s }), binding(op))) refused();
}
export interface GaslessFirstSendProof { readonly kind: "gasless-first-send-proof" }
interface Issued { readonly authority: GaslessFirstSendAuthority; readonly root: string; readonly controller: object;
  readonly approval: GaslessFirstSendApproval; claimed: boolean }
const proofs = new WeakMap<GaslessFirstSendProof, Issued>();
/** Receipt metadata is evidence only. A fresh, private proof belongs to one root/controller instance. */
export class GaslessFirstSendAuthority {
  readonly #root: string;
  readonly #controller: object;
  readonly #now: () => number;
  constructor(root: string, controller: object, now: () => number) {
    this.#root = root; this.#controller = controller; this.#now = now;
  }
  async approve(op: GaslessOperationRecord, port: GaslessApprovalPort): Promise<GaslessFirstSendProof | null> {
    assertSealedFirstSend(op);
    const issuedAt = instant(this.#now());
    if (issuedAt < op.intent.expiresAt) refused();
    const draft = { ...binding(op), issuedAt, expiresAt: instant(Date.parse(issuedAt) + TTL_MS) };
    const approvalFingerprint = hashObject(draft);
    const accepted = await port.confirm({ operationId: op.operationId, fingerprint: approvalFingerprint,
      exactPhrase: approvalFingerprint.slice(0, 8),
      summary: { ...publicGaslessOperation(op), sealed_first_send_approval: { ...draft, approvalFingerprint } } });
    if (!accepted) return null;
    const approvedAt = instant(this.#now());
    if (approvedAt < issuedAt || approvedAt >= draft.expiresAt) refused();
    const body = { ...draft, approvedAt, approvalFingerprint };
    const approval = Object.freeze({ ...body, approvalDigest: hashObject(body) });
    const proof = Object.freeze({ kind: "gasless-first-send-proof" as const });
    proofs.set(proof, { authority: this, root: this.#root, controller: this.#controller, approval, claimed: false });
    return proof;
  }
  metadata(proof: GaslessFirstSendProof): GaslessFirstSendApproval { return this.checked(proof).approval; }
  assert(proof: GaslessFirstSendProof, op: GaslessOperationRecord, claimed = false): void {
    const entry = this.checked(proof);
    if (entry.claimed !== claimed || !gaslessSame(binding(op), bindingFromApproval(entry.approval)) ||
      !gaslessSame(op.firstSendApprovals?.at(-1), entry.approval)) refused();
    if (!claimed) assertSealedFirstSend(op);
    else if (op.userOperation.submissionAttempts !== 1 || op.userOperation.disclosureAttempts !== 0) refused();
  }
  claim(proof: GaslessFirstSendProof, op: GaslessOperationRecord): void {
    this.assert(proof, op); this.checked(proof).claimed = true;
  }
  revoke(proof: GaslessFirstSendProof): void { const entry = proofs.get(proof); if (entry?.authority === this) proofs.delete(proof); }
  private checked(proof: GaslessFirstSendProof): Issued {
    const entry = proofs.get(proof), at = instant(this.#now());
    if (entry === undefined || entry.authority !== this || entry.root !== this.#root || entry.controller !== this.#controller ||
      this.#root.length === 0 || this.#controller === null ||
      at < entry.approval.approvedAt || at >= entry.approval.expiresAt) refused();
    return entry;
  }
}
function bindingFromApproval(a: GaslessFirstSendApproval) {
  const { approvalDigest: _digest, approvalFingerprint: _fingerprint, approvedAt: _approved,
    issuedAt: _issued, expiresAt: _expires, ...bound } = a; return bound;
}
function instant(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) refused(); return new Date(value).toISOString();
}
function refused(): never { return gaslessFailure("APN_OPERATION_BLOCKED", "gasless_sealed_first_send_authority"); }
