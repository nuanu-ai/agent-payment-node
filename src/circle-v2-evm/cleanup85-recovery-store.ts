import { exactKeys, hashObject, isPlainRecord, canonicalJson, sha256 } from "../canonical.js";
import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { validateEvmNativeCustody, type EvmNativeCustody } from "../evm-native-custody.js";
import { SecureStateStore } from "../secure-state-store.js";
import { assertConsumedBurnIdentity, SEALED_BURN_OPERATION } from "./burn-retirement.js";
import { circleRetirementBinding, type CircleNonceRetirementIntent } from "./nonce-retirement-store.js";
import { assertConsumedBurnEvidence, type ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { circleBlocked, type CircleOperationV1, type CirclePolicy } from "./operation-model.js";
export const CLEANUP85_HASH = "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95";
export const CLEANUP85_MATERIAL = "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
export const CLEANUP85_ENVELOPE = "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583";
export interface Cleanup85RecoveryIntent {
  readonly version: "apn.circle-cleanup85-recovery.v1";
  readonly parentOperationId: typeof SEALED_BURN_OPERATION;
  readonly parentIntentHash: string;
  readonly parentBinding: string;
  readonly parentPrefix: readonly string[];
  readonly sourceCustody: EvmNativeCustody;
  readonly destinationCustody: EvmNativeCustody;
  readonly recipientCustody: EvmNativeCustody;
  readonly policies: readonly CirclePolicy[];
  readonly capturedAt: string;
  readonly windowEndsAt: string | null;
  readonly evidence: ConsumedBurnEvidence;
  readonly recoveryBinding: string;
}
export function assertCleanup85Parent(op: CircleOperationV1): void {
  assertConsumedBurnIdentity(op); const e = op.effects.find(x => x.role === "cleanup");
  if (op.effects.length !== 3 || e?.phase !== "unknown" || e.transactionHash !== CLEANUP85_HASH || e.materialHash !== CLEANUP85_MATERIAL || e.envelope.envelopeHash !== CLEANUP85_ENVELOPE || e.envelope.nonceAtomic !== "85" || e.proof !== null ||
    op.transitions.some(t => /^cleanup_(?:submission|submitted)/u.test(t.reason)) || !op.transitions.some(t => t.reason === "cleanup_material_sealed")) circleBlocked("exact_unknown_cleanup85_parent_required");
}
export function cleanup85CancellationRequest(intent: Cleanup85RecoveryIntent): Cleanup85CancellationRequest {
  return { parentOperationId: SEALED_BURN_OPERATION, parentIntentHash: intent.parentIntentHash, recoveryBinding: intent.recoveryBinding, oldCleanupTransactionHash: CLEANUP85_HASH, oldCleanupMaterialHash: CLEANUP85_MATERIAL, oldCleanupEnvelopeHash: CLEANUP85_ENVELOPE };
}
const instant = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function validateCleanup85RecoveryIntent(value: unknown, op: CircleOperationV1, parent: CircleNonceRetirementIntent): Cleanup85RecoveryIntent {
  assertCleanup85Parent(op);
  if (!isPlainRecord(value) || !exactKeys(value, ["version", "parentOperationId", "parentIntentHash", "parentBinding", "parentPrefix", "sourceCustody", "destinationCustody", "recipientCustody", "policies", "capturedAt", "windowEndsAt", "evidence", "recoveryBinding"])) circleBlocked("cleanup85_recovery_intent_shape");
  const i = value as unknown as Cleanup85RecoveryIntent, { recoveryBinding, ...body } = i;
  if (i.version !== "apn.circle-cleanup85-recovery.v1" || i.parentOperationId !== SEALED_BURN_OPERATION || i.parentIntentHash !== parent.intentHash || parent.version !== "apn.circle-consumed-burn-retirement.v1" || parent.cleanupEnvelope.envelopeHash !== CLEANUP85_ENVELOPE || i.parentBinding !== circleRetirementBinding(op) || recoveryBinding !== hashObject(body) ||
    !Array.isArray(i.parentPrefix) || i.parentPrefix.length < 14 || i.parentPrefix.some((x, n) => x !== op.transitions[n]?.snapshotHash) || hashObject(i.sourceCustody) !== hashObject(op.sourceCustody) || hashObject(i.destinationCustody) !== hashObject(op.destinationCustody) ||
    !instant(i.capturedAt) || i.windowEndsAt !== null && !instant(i.windowEndsAt) || !Array.isArray(i.policies) || i.policies.length !== 2 || new Set(i.policies.map(p => p.profileHash)).size !== 2) circleBlocked("cleanup85_recovery_intent_binding");
  for (const p of i.policies) if (!isPlainRecord(p) || !exactKeys(p, ["profile", "profileHash", "policyDigest", "revision", "activationDigest"]) || ![op.profile, op.destinationProfile].includes(p.profile) || p.profileHash !== (p.profile === op.profile ? op.profileHash : op.destinationProfileHash) || ![p.policyDigest, p.activationDigest].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) || !Number.isSafeInteger(p.revision) || p.revision < 1) circleBlocked("cleanup85_recovery_policy_shape");
  validateEvmNativeCustody(i.recipientCustody);
  if (i.recipientCustody.walletAddress !== "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14" || i.recipientCustody.profileHash !== sha256("profile\0default")) circleBlocked("cleanup85_default_recipient_changed");
  assertConsumedBurnEvidence(i.evidence, op); return i;
}
export function assertCleanup85Window(i: Cleanup85RecoveryIntent, now: number): void {
  if (now < Date.parse(i.capturedAt) || i.windowEndsAt !== null && now >= Date.parse(i.windowEndsAt)) circleBlocked("cleanup85_recovery_policy_window_expired");
}
export class Cleanup85RecoveryStore extends SecureStateStore {
  private path(id: string, suffix = "intent") { if (id !== SEALED_BURN_OPERATION) circleBlocked("finite_cleanup85_recovery_only"); return `circle-cleanup85-recovery/${id}-${suffix}.json`; }
  async load(op: CircleOperationV1, parent: CircleNonceRetirementIntent): Promise<Cleanup85RecoveryIntent | null> {
    const value = await this.readJson(this.path(op.operationId)); return value === null ? null : validateCleanup85RecoveryIntent(value, op, parent);
  }
  async start(op: CircleOperationV1, parent: CircleNonceRetirementIntent, frame: Omit<Cleanup85RecoveryIntent, "version" | "parentOperationId" | "parentIntentHash" | "parentBinding" | "parentPrefix" | "recoveryBinding">): Promise<Cleanup85RecoveryIntent> {
    const existing = await this.load(op, parent); if (existing !== null) return existing;
    const body = { version: "apn.circle-cleanup85-recovery.v1" as const, parentOperationId: SEALED_BURN_OPERATION, parentIntentHash: parent.intentHash, parentBinding: circleRetirementBinding(op), parentPrefix: op.transitions.map(t => t.snapshotHash), ...frame };
    const intent = validateCleanup85RecoveryIntent({ ...body, recoveryBinding: hashObject(body) }, op, parent);
    await this.initialize(); await this.ensureDirectory("circle-cleanup85-recovery"); await this.writeJson(this.path(op.operationId), intent, true); return intent;
  }
  async publicRecord(op: CircleOperationV1, suffix: string): Promise<unknown> { return this.readJson(this.path(op.operationId, suffix)); }
  async createPublicRecord(op: CircleOperationV1, suffix: string, value: unknown): Promise<void> {
    const current = await this.publicRecord(op, suffix); if (current !== null) { if (canonicalJson(current) !== canonicalJson(value)) circleBlocked("cleanup85_recovery_record_replacement"); return; }
    await this.initialize(); await this.ensureDirectory("circle-cleanup85-recovery"); await this.writeJson(this.path(op.operationId, suffix), value, true);
  }
}
