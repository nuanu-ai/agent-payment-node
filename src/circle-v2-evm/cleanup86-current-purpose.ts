import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { assertHeldCleanup85Scope, type HeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import { verifyCleanup85CancellationAccounting } from "../circle-cleanup85-native-cancellation.js";
import type { Cleanup85CancellationProof } from "../circle-cleanup85-cancellation-contract.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { assertExclusiveEvmRawSigner } from "../evm-address-ownership.js";
import { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import { AllowlistPolicyStore, stagedRecordAccounts } from "../allowlist-policy-store.js";
import { CircleRepository } from "./repository.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest, type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { circleBlocked, validateCircleEnvelope, type CircleEnvelope, type CircleOperationV1, type CirclePolicy } from "./operation-model.js";
import { CircleUsage } from "./usage.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { verifyCancellationPublic, assertCancellationProofShape } from "./cleanup85-public-proof.js";
import { recheckCleanup86Admission } from "./cleanup86-public-admission.js";
import { currentCircleDeployments, type CircleRpc } from "./rpc.js";

/** Persisted evidence of a new permission decision, never a dispatch capability. */
export interface Cleanup86CurrentPurpose {
  readonly version: "apn.circle-cleanup86-current-purpose.v1";
  readonly rootBinding: string; readonly parentOperationId: string; readonly parentFingerprint: string;
  readonly recoveryBinding: string; readonly recoveryHash: string; readonly requestBinding: string;
  readonly cancellationProofHash: string; readonly sourceCustodyHash: string;
  readonly envelopeHash: string; readonly cleanupReservationId: string; readonly cleanupReservationHash: string;
  readonly maximumFeeAtomic: "15000000000000"; readonly policies: readonly CirclePolicy[];
  readonly capturedAt: string; readonly asOfDate: string; readonly windowEndsAt: string | null;
  readonly purposeHash: string;
}
export interface VerifiedCleanup86CurrentPurpose { readonly kind: "verified-cleanup86-current-purpose"; }
interface Certificate { readonly state: StateStore; readonly opHash: string; readonly scope: HeldCleanup85Scope; readonly proof: Cleanup85CancellationProof; readonly recovery: Cleanup85RecoveryIntent; readonly body: Cleanup86CurrentPurpose; readonly now: () => number; started: boolean; executed: boolean; }
const certificates = new WeakMap<VerifiedCleanup86CurrentPurpose, Certificate>();
function leaseBinding(op: CircleOperationV1): string { const row = op.usage[3]; if (row === undefined) circleBlocked("cleanup86_current_hold_missing"); const { state: _state, updatedAt: _at, effectAt: _effect, outcomeDigest: _outcome, consumedAtomic: _consumed, reservationDigest: _digest, ...historical } = row; return hashObject(historical); }
const digest = (x: unknown): boolean => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x);
const instant = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
export function validateCleanup86CurrentPurpose(value: unknown, stateRoot: string, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Cleanup86CurrentPurpose {
  if (!isPlainRecord(value) || !exactKeys(value, ["version", "rootBinding", "parentOperationId", "parentFingerprint", "recoveryBinding", "recoveryHash", "requestBinding", "cancellationProofHash", "sourceCustodyHash", "envelopeHash", "cleanupReservationId", "cleanupReservationHash", "maximumFeeAtomic", "policies", "capturedAt", "asOfDate", "windowEndsAt", "purposeHash"])) circleBlocked("cleanup86_current_purpose_shape");
  const p = value as unknown as Cleanup86CurrentPurpose, { purposeHash, ...body } = p, lease = op.usage[3];
  validateCircleEnvelope(envelope, "cleanup", 1329, null, "evm-live-seller");
  if (p.version !== "apn.circle-cleanup86-current-purpose.v1" || purposeHash !== hashObject(body) || p.rootBinding !== hashObject({ root: stateRoot }) || p.parentOperationId !== op.operationId || p.parentFingerprint !== op.fingerprint || p.recoveryBinding !== recovery.recoveryBinding || p.recoveryHash !== hashObject(recovery) || p.requestBinding !== hashObject(cleanup85CancellationRequest(recovery)) || !digest(p.cancellationProofHash) || p.sourceCustodyHash !== hashObject(op.sourceCustody) || p.envelopeHash !== envelope.envelopeHash || envelope.nonceAtomic !== "86" || BigInt(envelope.gasLimitAtomic) * BigInt(envelope.maxFeePerGasAtomic) > 15000000000000n || p.maximumFeeAtomic !== "15000000000000" || lease === undefined || lease.account !== op.sourceCustody.walletAddress || lease.chain !== "eip155:42161" || lease.asset.kind !== "native" || lease.amountAtomic !== p.maximumFeeAtomic || p.cleanupReservationId !== lease.reservationId || p.cleanupReservationHash !== leaseBinding(op) || !instant(p.capturedAt) || p.asOfDate !== p.capturedAt.slice(0, 10) || p.windowEndsAt !== null && (!instant(p.windowEndsAt) || p.windowEndsAt <= p.capturedAt) || !Array.isArray(p.policies) || p.policies.length !== 2) circleBlocked("cleanup86_current_purpose_binding");
  for (const [index, profile] of [op.profile, op.destinationProfile].entries()) {
    const policy = p.policies[index];
    if (!isPlainRecord(policy) || !exactKeys(policy, ["profile", "profileHash", "policyDigest", "revision", "activationDigest"]) || policy.profile !== profile || policy.profileHash !== (index === 0 ? op.profileHash : op.destinationProfileHash) || !digest(policy.policyDigest) || !digest(policy.activationDigest) || typeof policy.revision !== "number" || !Number.isSafeInteger(policy.revision) || policy.revision < 1) circleBlocked("cleanup86_current_policy_binding");
  }
  return p;
}
function detached<T>(v: T): T { const copy = structuredClone(v), freeze = (x: unknown): void => { if (x !== null && typeof x === "object") { for (const y of Object.values(x)) freeze(y); Object.freeze(x); } }; freeze(copy); return copy; }
export function verifiedCleanup86CurrentPurpose(token: VerifiedCleanup86CurrentPurpose, state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Cleanup86CurrentPurpose {
  const c = certificates.get(token);
  if (c === undefined || c.state !== state || c.opHash !== hashObject(op) || hashObject(c.recovery) !== hashObject(recovery)) circleBlocked("cleanup86_private_current_purpose_required");
  assertHeldCleanup85Scope(c.scope, state, cleanup85CancellationRequest(recovery), c.proof.operationId);
  const p = validateCleanup86CurrentPurpose(c.body, state.root, op, recovery, envelope), at = c.now();
  if (at < Date.parse(p.capturedAt) || new Date(at).toISOString().slice(0, 10) !== p.asOfDate || p.windowEndsAt !== null && at >= Date.parse(p.windowEndsAt)) circleBlocked("cleanup86_current_purpose_expired");
  return p;
}
/** Only canonical F85 plus current owner policies under the real shared lock scope can issue this.
 * Original policy/lease records remain historical; confirm includes their full carry holds once. */
export async function verifyCleanup86CurrentPurpose(state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, proof: Cleanup85CancellationProof, envelope: CircleEnvelope, source: CircleRpc, destination: CircleRpc, now: () => number, scope: HeldCleanup85Scope, retained?: Cleanup86CurrentPurpose): Promise<VerifiedCleanup86CurrentPurpose> {
  op = detached(op); recovery = detached(recovery); proof = detached(proof); envelope = detached(envelope);
  if (recovery.windowEndsAt === null || now() < Date.parse(recovery.windowEndsAt)) circleBlocked("cleanup86_current_expired_original_required");
  const request = cleanup85CancellationRequest(recovery); assertHeldCleanup85Scope(scope, state, request, proof.operationId);
  const saved = await new CircleRepository(state.root).load(op.operationId), parent = await new CircleNonceRetirementStore(state.root).intent(op);
  if (saved === null || canonicalJson(saved) !== canonicalJson(op) || parent === null || canonicalJson(await new Cleanup85RecoveryStore(state.root).load(op, parent)) !== canonicalJson(recovery) || proof.requestBinding !== hashObject(request) || hashObject(proof.sourceCustody) !== hashObject(recovery.sourceCustody) || hashObject(proof.recipientCustody) !== hashObject(recovery.recipientCustody)) circleBlocked("cleanup86_current_durable_binding");
  assertCancellationProofShape(proof); await verifyCleanup85CancellationAccounting(state, request, proof);
  const cancellation = await verifyCancellationPublic(source, proof), evidence = await consumedBurnEvidence(source, op, "cancel85");
  await currentCircleDeployments(source, destination, 1329); await recheckCleanup86Admission(source, evidence, cancellation);
  for (const [profile, custody] of [[op.profile, op.sourceCustody], [op.destinationProfile, op.destinationCustody], ["default", recovery.recipientCustody]] as const) { await assertEvmNativeCustody(state, profile, custody); await assertExclusiveEvmRawSigner(state, custody.walletAddress, custody.profileHash); }
  await new OperationService(state).assertCircleAccountsAvailable(op, true, "cleanup");
  const usage = new CircleUsage(state, now);
  const body = await usage.withCleanup85HeldPolicyScope(scope, request, proof.operationId, async () => {
    const policies = retained?.policies ?? await usage.retirementPolicies(op);
    await usage.confirm(op, policies); const windowEndsAt = await usage.authorizationDeadline(op, policies), capturedAt = retained?.capturedAt ?? new Date(now()).toISOString();
    const lease = op.usage[3]; if (lease === undefined) circleBlocked("cleanup86_current_hold_missing");
    const frame = { version: "apn.circle-cleanup86-current-purpose.v1" as const, rootBinding: hashObject({ root: state.root }), parentOperationId: op.operationId, parentFingerprint: op.fingerprint, recoveryBinding: recovery.recoveryBinding, recoveryHash: hashObject(recovery), requestBinding: hashObject(request), cancellationProofHash: proof.proofHash, sourceCustodyHash: hashObject(op.sourceCustody), envelopeHash: envelope.envelopeHash, cleanupReservationId: lease.reservationId, cleanupReservationHash: leaseBinding(op), maximumFeeAtomic: "15000000000000" as const, policies, capturedAt, asOfDate: capturedAt.slice(0, 10), windowEndsAt };
    const p = validateCleanup86CurrentPurpose({ ...frame, purposeHash: hashObject(frame) }, state.root, op, recovery, envelope);
    if (retained !== undefined && canonicalJson(retained) !== canonicalJson(p)) circleBlocked("cleanup86_current_authority_changed");
    return detached(p);
  });
  if ((await new CircleRepository(state.root).load(op.operationId))?.integrityHash !== op.integrityHash) circleBlocked("cleanup86_current_parent_changed");
  const token = Object.freeze({ kind: "verified-cleanup86-current-purpose" as const }); certificates.set(token, { state, opHash: hashObject(op), scope, proof: detached(proof), recovery: detached(recovery), body, now, started: false, executed: false }); verifiedCleanup86CurrentPurpose(token, state, op, recovery, envelope); return token;
}

/** Policy/custody recheck at every private boundary; canonical public reads stay in preflight. */
export async function assertCleanup86CurrentPermission(token: VerifiedCleanup86CurrentPurpose, state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Promise<void> {
  const p = verifiedCleanup86CurrentPurpose(token, state, op, recovery, envelope), c = certificates.get(token)!;
  for (const [profile, custody] of [[op.profile, op.sourceCustody], [op.destinationProfile, op.destinationCustody], ["default", recovery.recipientCustody]] as const) { await assertEvmNativeCustody(state, profile, custody); await assertExclusiveEvmRawSigner(state, custody.walletAddress, custody.profileHash); }
  await new OperationService(state).assertCircleAccountsAvailable(op, true, "cleanup");
  const usage = new CircleUsage(state, c.now);
  await usage.withCleanup85HeldPolicyScope(c.scope, cleanup85CancellationRequest(recovery), c.proof.operationId, async () => {
    await usage.confirm(op, p.policies); if (await usage.authorizationDeadline(op, p.policies) !== p.windowEndsAt) circleBlocked("cleanup86_current_authority_changed");
  });
  verifiedCleanup86CurrentPurpose(token, state, op, recovery, envelope);
}

export function claimCleanup86CurrentStart(token: VerifiedCleanup86CurrentPurpose, state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Cleanup86CurrentPurpose {
  const body = verifiedCleanup86CurrentPurpose(token, state, op, recovery, envelope), c = certificates.get(token)!;
  if (c.started || c.executed) circleBlocked("cleanup86_current_certificate_used"); c.started = true; return body;
}
export function claimCleanup86CurrentExecution(token: VerifiedCleanup86CurrentPurpose, state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Cleanup86CurrentPurpose {
  const body = verifiedCleanup86CurrentPurpose(token, state, op, recovery, envelope), c = certificates.get(token)!;
  if (!c.started || c.executed) circleBlocked("cleanup86_current_certificate_used"); c.executed = true; return body;
}

/** Historical authentication only: later activation/expiry cannot invalidate a recorded86 proof. */
export async function authenticateCleanup86CurrentHistory(root: string, op: CircleOperationV1, purpose: Cleanup86CurrentPurpose): Promise<void> {
  const store = new AllowlistPolicyStore(root); let end = Infinity;
  for (const [index, policy] of purpose.policies.entries()) {
    const state = await store.readUnderProfileLock(policy.profile), record = state.records.find(r => r.revision === policy.revision), entry = state.entries.find(e => e.entryDigest === policy.activationDigest);
    if (record === undefined || entry === undefined || entry.status !== "active" || entry.revision !== policy.revision || entry.policyDigest !== policy.policyDigest || record.registry.policyDigest !== policy.policyDigest || stagedRecordAccounts(record).evm !== (index === 0 ? op.sourceCustody.walletAddress : op.destinationCustody.walletAddress) || entry.decidedAt > purpose.capturedAt || record.registry.effectiveDate > purpose.asOfDate || record.registry.effectiveAt !== undefined && record.registry.effectiveAt > purpose.capturedAt) circleBlocked("cleanup86_current_history_changed");
    if (record.registry.expiresAt !== undefined) end = Math.min(end, Date.parse(record.registry.expiresAt));
  }
  if (purpose.windowEndsAt !== (end === Infinity ? null : new Date(end).toISOString())) circleBlocked("cleanup86_current_history_window_changed");
}
