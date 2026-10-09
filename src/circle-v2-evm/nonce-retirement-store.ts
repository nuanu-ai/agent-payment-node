import { hashObject, exactKeys, isPlainRecord } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked, circleCorrupt, validateCircleEnvelope, type CircleEnvelope, type CircleOperationV1 } from "./operation-model.js";
const ROOT = "circle-v2-nonce-retirements";
export interface CircleNonceRetirementIntent {
  readonly version: "apn.circle-nonce-retirement.v1"; readonly operationId: string; readonly binding: string;
  readonly prefix: readonly string[]; readonly cleanupEnvelope: CircleEnvelope; readonly intentHash: string;
}
/** Immutable public identity only. No sealed wire, ciphertext or signing key enters this record. */
export function circleRetirementBinding(op: CircleOperationV1): string {
  const approval = op.effects[0]!, burn = op.effects[1]!;
  return hashObject({ operationId: op.operationId, fingerprint: op.fingerprint, sourceCustody: op.sourceCustody,
    destinationCustody: op.destinationCustody, policies: op.policies, deploymentDigest: op.deploymentDigest,
    expiresAt: op.expiresAt, approval: { envelope: approval.envelope, transactionHash: approval.transactionHash, materialHash: approval.materialHash }, burn: burn.envelope });
}
export class CircleNonceRetirementStore extends SecureStateStore {
  private path(id: string, suffix = "intent") { if (!/^[a-f0-9]{64}$/u.test(id)) circleCorrupt("retirement_id"); return `${ROOT}/${id}-${suffix}.json`; }
  async intent(op: CircleOperationV1): Promise<CircleNonceRetirementIntent | null> {
    const value = await this.readJson(this.path(op.operationId)); if (value === null) return null;
    if (!isPlainRecord(value) || !exactKeys(value, ["version", "operationId", "binding", "prefix", "cleanupEnvelope", "intentHash"])) circleCorrupt("retirement_intent_shape");
    const intent = value as unknown as CircleNonceRetirementIntent, { intentHash, ...body } = intent;
    if (intent.version !== "apn.circle-nonce-retirement.v1" || intentHash !== hashObject(body) || intent.operationId !== op.operationId || intent.binding !== circleRetirementBinding(op) ||
      !Array.isArray(intent.prefix) || intent.prefix.length < 5 || intent.prefix.some(x => typeof x !== "string" || !/^[a-f0-9]{64}$/u.test(x))) circleCorrupt("retirement_intent_binding");
    validateCircleEnvelope(intent.cleanupEnvelope, "cleanup", op.destinationChain, null, op.destinationProfile);
    if (intent.cleanupEnvelope.nonceAtomic !== op.effects[0]!.envelope.nonceAtomic) circleCorrupt("retirement_nonce_changed");
    return intent;
  }
  async start(op: CircleOperationV1, cleanupEnvelope: CircleEnvelope): Promise<CircleNonceRetirementIntent> {
    const previous = await this.intent(op); if (previous !== null) return previous;
    const body = { version: "apn.circle-nonce-retirement.v1" as const, operationId: op.operationId, binding: circleRetirementBinding(op),
      prefix: op.transitions.map(x => x.snapshotHash), cleanupEnvelope };
    const intent = { ...body, intentHash: hashObject(body) };
    validateCircleEnvelope(cleanupEnvelope, "cleanup", op.destinationChain, null, op.destinationProfile);
    if (cleanupEnvelope.nonceAtomic !== op.effects[0]!.envelope.nonceAtomic) circleBlocked("retirement_exact_original_nonce_required");
    await this.initialize(); await this.ensureDirectory(ROOT); await this.writeJson(this.path(op.operationId), intent, true);
    return (await this.intent(op))!;
  }
  async assertOriginalEffectsAvailable(operationId: string): Promise<void> {
    // The intent itself is the permanent source tombstone, independent of a restorable operation journal.
    if (await this.readJson(this.path(operationId)) !== null) circleBlocked("original_source_permanently_retired");
  }
  async claim(op: CircleOperationV1, boundary: "sign" | "send"): Promise<void> {
    const intent = await this.intent(op); if (intent === null) circleBlocked("retirement_intent_required");
    const effect = op.effects.find(x => x.role === "cleanup");
    if (effect?.envelope.envelopeHash !== intent.cleanupEnvelope.envelopeHash) circleBlocked("retirement_cleanup_envelope_changed");
    const path = this.path(op.operationId, boundary);
    if (await this.readJson(path) !== null) circleBlocked(`retirement_${boundary}_already_claimed_observe_only`);
    if (boundary === "sign" && effect.phase !== "signing_started" || boundary === "send" && (effect.phase !== "submission_started" || effect.transactionHash === null || effect.materialHash === null)) circleBlocked("retirement_claim_boundary_changed");
    if (boundary === "send") await this.assertClaim(op, "sign");
    await this.writeJson(path, { version: "apn.circle-retirement-claim.v1", boundary, operationId: op.operationId, intentHash: intent.intentHash, ...(boundary === "send" ? { transactionHash: effect.transactionHash, materialHash: effect.materialHash } : {}) }, true);
  }
  async assertClaim(op: CircleOperationV1, boundary: "sign" | "send"): Promise<void> {
    const intent = await this.intent(op), value = await this.readJson(this.path(op.operationId, boundary));
    if (intent === null || !isPlainRecord(value) || !exactKeys(value, ["version", "boundary", "operationId", "intentHash", ...(boundary === "send" ? ["transactionHash", "materialHash"] : [])]) ||
      value.version !== "apn.circle-retirement-claim.v1" || value.boundary !== boundary || value.operationId !== op.operationId || value.intentHash !== intent.intentHash || boundary === "send" && (value.transactionHash !== op.effects.find(x => x.role === "cleanup")?.transactionHash || value.materialHash !== op.effects.find(x => x.role === "cleanup")?.materialHash)) circleBlocked("retirement_durable_claim_required");
  }
  async hasClaim(op: CircleOperationV1, boundary: "sign" | "send"): Promise<boolean> {
    if (await this.readJson(this.path(op.operationId, boundary)) === null) return false;
    await this.assertClaim(op, boundary); return true;
  }
}
