import { LocalWalletNative } from "../local-wallet-native.js";
import { Permit2ProductionSigningFence } from "./production-signing-fence.js";
import type { Permit2NativeRequestExecution, Permit2NativeSigningExecution } from "./production-native-capability.js";
import { claimPermit2ForegroundApproval, assertClaimedPermit2ForegroundApproval, revokePermit2ForegroundApproval,
  type Permit2ForegroundApprovalProof, type Permit2ApprovalBinding } from "./production-approval-provenance.js";
import { assertSigningLifecycle, checkedSigningLease } from "./production-signing-owner.js";
import { assertSigningTime } from "./production-signing-facts.js";
export interface Permit2SigningContinuation { readonly kind: "permit2-private-signing-continuation" }
interface FirstRequestProof { readonly kind: "permit2-private-first-request-proof" }
type RiskCandidate = { readonly kind: "permit2-private-risk-candidate" };
import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { AssetUsageLedger, type AssetUsageReservation } from "../asset-usage-ledger.js";
import { OperationService } from "../operation-service.js";
import { assertPermit2OwnerLocked } from "./production-owner-admission.js";
import { StateStore } from "../state.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { Permit2ProductionPreparation } from "./production-prepare.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { Permit2ProductionRepository, productionRecordBody, productionUsageIdentity, productionUsageKey,
  sealPermit2ProductionRecord, type Permit2ProductionRecord } from "./production-repository.js";
import { validatePermit2ProductionSigned, type Permit2ProductionSigned } from "./production-signed.js";
import { consumePermit2ObservationProof, type Permit2ObservationProof, type Permit2ObservationMode } from "./production-observer.js";
import { JOURNAL_SCHEMA, productionApprovalFingerprint, productionRiskBinding, productionTerminalDigest,
  type Permit2ExposureJournal, type Permit2TerminalIntent } from "./production-journal-codec.js";

/** Storage/accounting only. No key, signing, transport or execution permission is returned. */
export class Permit2ProductionJournal extends Permit2ProductionRepository {
  readonly #firstRequests = new WeakMap<FirstRequestProof, { readonly execution: Permit2NativeRequestExecution; readonly record: Permit2ProductionRecord }>();
  static markNativeRequestPending(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeRequestExecution) {
    return journal.#markNativeRequestPending(id, execution);
  }
  static consumeNativeFirstRequestProof(journal: Permit2ProductionJournal, id: string,
    execution: Permit2NativeRequestExecution, proof: FirstRequestProof): Permit2ProductionRecord {
    LocalWalletNative.assertPermit2RequestExecution(execution, journal, id);
    const saved = journal.#firstRequests.get(proof);
    if (saved === undefined || saved.execution !== execution || saved.record.operationId !== id) blocked();
    journal.#firstRequests.delete(proof); return saved.record;
  }
  #assertNativeRequestRecord(id: string, execution: Permit2NativeRequestExecution, r: Permit2ProductionRecord, lease: AssetUsageReservation): void {
    const origin = LocalWalletNative.assertPermit2RequestExecution(execution, this, id);
    assertSigningLifecycle(r, "dispatch"); checkedSigningLease(r, lease, "dispatch");
    if (r.material.materialHash !== origin.materialHash || r.material.checked.requestHash !== origin.requestHash ||
        r.material.checked.challengeHash !== origin.challengeHash || r.exposureJournal?.signed?.signedHash !== origin.signedHash ||
        lease.reservationDigest !== origin.grant.lease.reservationDigest ||
        canonicalJson(r.material.wallet) !== canonicalJson(origin.grant.record.material.wallet)) blocked();
  }
  async #markNativeRequestPending(id: string, execution: Permit2NativeRequestExecution): Promise<{ readonly record: Permit2ProductionRecord; readonly proof: FirstRequestProof | null }> {
    LocalWalletNative.assertPermit2RequestExecution(execution, this, id);
    const r = await this.#required(id); this.#assertNativeRequestRecord(id, execution, r, await this.#lease(r));
    return this.state.withLocks(this.#locks(r), async () => {
      const current = await this.#required(id); this.#assertNativeRequestRecord(id, execution, current, await this.#lease(current));
      const j = current.exposureJournal!;
      if (j.request !== null) return Object.freeze({ record: current, proof: null });
      const next = await this.#save(current, { ...j, request: { attempt: 1, requestHash: current.material.checked.requestHash,
        headerHash: j.signed!.headerHash } }, "request_pending");
      LocalWalletNative.assertPermit2RequestExecution(execution, this, id);
      freezeApprovedSnapshot(next); const proof = Object.freeze({ kind: "permit2-private-first-request-proof" as const });
      this.#firstRequests.set(proof, { execution, record: next }); return Object.freeze({ record: next, proof });
    });
  }
  readonly #riskCandidates = new WeakMap<RiskCandidate, { readonly proof: Permit2ForegroundApprovalProof; readonly binding: Permit2ApprovalBinding; readonly riskRecord: Permit2ProductionRecord }>();
  // Only the actual native execution can consume this private continuation.
  readonly #continuations = new WeakMap<Permit2SigningContinuation, { readonly binding: Permit2ApprovalBinding;
    readonly record: Permit2ProductionRecord; readonly lease: AssetUsageReservation }>();
  readonly #nativeClaims = new WeakMap<Permit2NativeSigningExecution, {
    readonly binding: Permit2ApprovalBinding; readonly record: Permit2ProductionRecord; readonly lease: AssetUsageReservation }>();
  static claimNativeSigningContinuation(journal: Permit2ProductionJournal, id: string,
    continuation: Permit2SigningContinuation, execution: Permit2NativeSigningExecution) {
    return journal.#claimNativeSigningContinuation(id, continuation, execution);
  }
  static assertNativeSigningContinuation(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeSigningExecution) {
    return journal.#assertNativeSigningContinuation(id, execution);
  }
  static nativeSigningSecond(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeSigningExecution, capturedAt?: number): number {
    return journal.#nativeSigningSecond(id, execution, capturedAt);
  }
  static nativeOriginBinding(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeSigningExecution) {
    LocalWalletNative.assertPermit2SigningExecution(execution, journal, id);
    const grant = journal.#nativeClaims.get(execution); if (grant === undefined) blocked();
    journal.#nativeApprovalTime(grant.binding, grant.record); return Object.freeze({ ...grant });
  }
  static releaseNativeSigningContinuation(journal: Permit2ProductionJournal, execution: Permit2NativeSigningExecution): void {
    journal.#releaseNativeSigningContinuation(execution);
  }
  static storeNativeSigned(journal: Permit2ProductionJournal, id: string, value: Permit2ProductionSigned) {
    return journal.#storeSigned(id, value);
  }
  async #claimNativeSigningContinuation(id: string, continuation: Permit2SigningContinuation, execution: Permit2NativeSigningExecution) {
    const native = LocalWalletNative.assertPermit2SigningExecution(execution, this, id);
    const grant = this.#continuations.get(continuation);
    if (grant === undefined || this.#nativeClaims.has(execution) || grant.binding.native !== native.native ||
      grant.binding.capability !== native.capability || grant.binding.nativeState !== native.state ||
      grant.binding.root !== native.root || grant.binding.operationId !== id) blocked();
    this.#continuations.delete(continuation); this.#nativeClaims.set(execution, grant);
    return this.#assertNativeSigningContinuation(id, execution);
  }
  async #assertNativeSigningContinuation(id: string, execution: Permit2NativeSigningExecution): Promise<Permit2ProductionRecord> {
    const native = LocalWalletNative.assertPermit2SigningExecution(execution, this, id);
    const grant = this.#nativeClaims.get(execution); if (grant === undefined) blocked();
    this.#nativeApprovalTime(grant.binding, grant.record);
    const current = await Permit2ProductionSigningFence.nativeScopeOwner(native.fence, native.scope, native.root, id);
    LocalWalletNative.assertPermit2SigningExecution(execution, this, id);
    if (this.#nativeClaims.get(execution) !== grant || current.record.integrityHash !== grant.record.integrityHash ||
      canonicalJson(current.record.material.wallet) !== canonicalJson(grant.record.material.wallet)) blocked();
    checkedSigningLease(current.record, current.lease, "exposed", grant); this.#nativeApprovalTime(grant.binding, current.record);
    return current.record;
  }
  #nativeSigningSecond(id: string, execution: Permit2NativeSigningExecution, capturedAt?: number): number {
    LocalWalletNative.assertPermit2SigningExecution(execution, this, id);
    const grant = this.#nativeClaims.get(execution); if (grant === undefined) blocked();
    const at = this.#nativeApprovalTime(grant.binding, grant.record).getTime();
    if (capturedAt !== undefined && (!Number.isSafeInteger(capturedAt) || at < capturedAt || at - capturedAt > 5_000)) blocked();
    return Math.floor(at / 1000);
  }
  #nativeApprovalTime(binding: Permit2ApprovalBinding, record: Permit2ProductionRecord): Date {
    const at = binding.clock();
    if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < binding.completedAt ||
      at.getTime() - binding.completedAt > 60_000) blocked();
    const now = new Date(at.getTime()); assertSigningTime(record, now); return now;
  }
  #releaseNativeSigningContinuation(execution: Permit2NativeSigningExecution): void { this.#nativeClaims.delete(execution); }
  private readonly state: StateStore;
  private readonly usage: AssetUsageLedger;
  constructor(root: string, private readonly preparation: Permit2ProductionPreparation,
    private readonly clock: () => Date = () => new Date()) {
    super(root); if (preparation.records.root !== this.root) blocked();
    this.state = new StateStore(root); this.usage = new AssetUsageLedger(root);
  }
  #now(): Date {
    const at = this.clock();
    if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < 0) blocked();
    return new Date(at.getTime());
  }
  #locks(r: Permit2ProductionRecord): string[] {
    return [`profile:${r.profileHash}`, `operation:${r.operationId}`, evmAddressLock(r.material.wallet.account)];
  }
  async #required(id: string): Promise<Permit2ProductionRecord> {
    const r = await Permit2ProductionRepository.findOwnedOperation(this, id); if (r === null) blocked(); return r;
  }
  async #lease(r: Permit2ProductionRecord): Promise<AssetUsageReservation> {
    const value = (await this.usage.usageWithReservation(productionUsageIdentity(r), r.usageReservationId, this.#now())).reservation;
    if (value === null || value.reservationId !== r.usageReservationId || value.policyDigest !== r.material.owner.policyDigest ||
        value.registryVersion !== r.material.checkpoint.registryVersion || value.rail !== "x402" ||
        value.amountAtomic !== reconstructPermit2ProductionMaterial(r.material).amountAtomic ||
        value.idempotencyHash !== sha256(`asset-usage-idempotency\0${productionUsageKey(r.operationId)}`)) blocked();
    return value;
  }
  async #save(r: Permit2ProductionRecord, j: Permit2ExposureJournal, state = r.state, terminal = r.terminal): Promise<Permit2ProductionRecord> {
    const next = sealPermit2ProductionRecord({ ...productionRecordBody(r), exposureJournal: j,
      state, terminal, updatedAt: this.#now().toISOString() });
    await this.#persistExposureLocked(next); return next;
  }
  async #persistExposureLocked(r: Permit2ProductionRecord): Promise<void> { await Permit2ProductionRepository.persistOwnedExposure(this, r); }
  /** Initial admission checks current owner. Replays can only reconcile the existing durable hold. */
  async markSignatureRisk(id: string): Promise<Permit2ProductionRecord> { return (await this.#markRisk(id)).record; }
  /** Genuine UI + atomic first insertion only. No key/sign/HTTP permission is conveyed. */
  async markApprovedSignatureRisk(id: string, proof: Permit2ForegroundApprovalProof): Promise<{
    readonly record: Permit2ProductionRecord; readonly continuation: Permit2SigningContinuation | null }> {
    let candidate: RiskCandidate | null = null;
    try {
      const result = await this.#markRisk(id, proof); candidate = result.candidate;
      if (candidate === null) { freezeApprovedSnapshot(result.record); return Object.freeze({ record: result.record, continuation: null }); }
      const owned = this.#riskCandidates.get(candidate); if (owned === undefined) blocked();
      return await this.state.withLocks(this.#locks(result.record), async () => {
        const current = await this.#required(id); assertSigningLifecycle(current, "exposed");
        if (current.material.materialHash !== owned.riskRecord.material.materialHash ||
          current.exposureAt !== owned.riskRecord.exposureAt || current.exposureJournal?.bindingHash !== owned.riskRecord.exposureJournal?.bindingHash) blocked();
        const lease = checkedSigningLease(current, await this.#lease(current), "exposed");
        assertClaimedPermit2ForegroundApproval(proof, this, current); this.#approvalTime(owned.binding, current);
        freezeApprovedSnapshot(current); freezeApprovedSnapshot(lease);
        const continuation = Object.freeze({ kind: "permit2-private-signing-continuation" as const });
        this.#continuations.set(continuation, { binding: owned.binding, record: current, lease });
        return Object.freeze({ record: current, continuation });
      });
    } finally { revokePermit2ForegroundApproval(proof); if (candidate !== null) this.#riskCandidates.delete(candidate); }
  }
  #approvalTime(binding: Permit2ApprovalBinding, record: Permit2ProductionRecord): void {
    const now = this.#now(); if (now.getTime() < binding.completedAt || now.getTime() - binding.completedAt > 60_000) blocked();
    assertSigningTime(record, now);
  }
  async #markRisk(id: string, proof?: Permit2ForegroundApprovalProof): Promise<{ readonly record: Permit2ProductionRecord; readonly candidate: RiskCandidate | null }> {
    await this.ready(); let r = await this.#required(id), candidate: RiskCandidate | null = null;
    if (r.exposureJournal !== undefined) return { record: await this.#confirmHold(id), candidate: null };
    r = await this.preparation.assertCurrentOwner(id);
    const usage = await this.usage.usageWithReservation(productionUsageIdentity(r), r.usageReservationId, this.#now());
    const lease = await this.#lease(r);
    if (r.state !== "reserved" || lease.state !== "reserved" || lease.reservationDigest !== r.usageReservationDigest) blocked();
    await this.state.withLocks(this.#locks(r), async () => {
      const current = await this.#required(id);
      if (current.exposureJournal !== undefined) return;
      if (current.integrityHash !== r.integrityHash) blocked();
      const at = this.#now();
      if (BigInt(Math.floor(at.getTime() / 1000)) >= BigInt(reconstructPermit2ProductionMaterial(current.material).expiresAtUnix)) blocked();
      const used = BigInt(usage.snapshot.amountAtomic) - BigInt(lease.amountAtomic);
      if (used < 0n) blocked();
      await assertPermit2OwnerLocked(this.state, new OperationService(this.state), current, at, used.toString());
      const p = reconstructPermit2ProductionMaterial(current.material);
      const journal: Permit2ExposureJournal = { schemaVersion: JOURNAL_SCHEMA,
        approvalFingerprint: productionApprovalFingerprint(current), bindingHash: productionRiskBinding(current),
        permit2Deadline: p.plan.authorization.deadline, eip2612Deadline: p.plan.eip2612?.info.deadline ?? null,
        holdConfirmed: false, signed: null, request: null, terminalIntent: null };
      const next = sealPermit2ProductionRecord({ ...productionRecordBody(current), state: "exposure_unknown",
        exposureAt: at.toISOString(), updatedAt: at.toISOString(), exposureJournal: journal });
      const binding = proof === undefined ? null : claimPermit2ForegroundApproval(proof, this, current);
      if (binding !== null) this.#approvalTime(binding, current);
      await this.#persistExposureLocked(next);
      if (binding !== null && proof !== undefined) {
        freezeApprovedSnapshot(next);
        candidate = Object.freeze({ kind: "permit2-private-risk-candidate" as const });
        this.#riskCandidates.set(candidate, { proof, binding, riskRecord: next });
      }
    });
    try { return { record: await this.#confirmHold(id), candidate }; }
    catch (error) { if (candidate !== null) this.#riskCandidates.delete(candidate); throw error; }
  }
  /** No state locks span ledger I/O; risk remains durable if either side fails. */
  async confirmHold(id: string): Promise<Permit2ProductionRecord> { return this.#confirmHold(id); }
  async #confirmHold(id: string): Promise<Permit2ProductionRecord> {
    const r = await this.#required(id), j = r.exposureJournal; if (j === undefined) blocked();
    if (r.terminal || j.terminalIntent !== null) return r;
    const lease = await this.#lease(r);
    if (!["reserved", "unknown_finality"].includes(lease.state)) blocked();
    if (lease.state === "reserved") await this.usage.transition({ ...productionUsageIdentity(r), reservationId: r.usageReservationId,
      policyDigest: r.material.owner.policyDigest, state: "unknown_finality", expectedCurrentStates: ["reserved", "unknown_finality"], now: this.#now() });
    return this.state.withLocks(this.#locks(r), async () => {
      const current = await this.#required(id), journal = current.exposureJournal;
      if (journal === undefined || journal.bindingHash !== j.bindingHash) blocked();
      if (current.terminal || journal.terminalIntent !== null || journal.holdConfirmed) return current;
      return this.#save(current, { ...journal, holdConfirmed: true });
    });
  }
  async storeSigned(id: string, value: Permit2ProductionSigned): Promise<Permit2ProductionRecord> { return this.#storeSigned(id, value); }
  async #storeSigned(id: string, value: Permit2ProductionSigned): Promise<Permit2ProductionRecord> {
    const snapshot = JSON.parse(canonicalJson(value)) as Permit2ProductionSigned;
    const r = await this.#required(id), signed = await validatePermit2ProductionSigned(snapshot, r);
    return this.state.withLocks(this.#locks(r), async () => {
      const current = await this.#required(id), j = current.exposureJournal;
      if (j === undefined || !j.holdConfirmed || current.terminal || j.terminalIntent !== null) blocked();
      if (j.signed !== null) { if (canonicalJson(j.signed) !== canonicalJson(signed)) blocked(); return current; }
      return this.#save(current, { ...j, signed });
    });
  }
  /** Attempt 1 is the sole durable request marker; it conveys no HTTP permission. */
  async markRequestPending(id: string): Promise<Permit2ProductionRecord> {
    const r = await this.#required(id);
    return this.state.withLocks(this.#locks(r), async () => {
      const current = await this.#required(id), j = current.exposureJournal;
      if (j === undefined || !j.holdConfirmed || j.signed === null || current.terminal || j.terminalIntent !== null) blocked();
      if (j.request !== null) return current;
      return this.#save(current, { ...j, request: { attempt: 1, requestHash: current.material.checked.requestHash,
        headerHash: j.signed.headerHash } }, "request_pending");
    });
  }
  /** Only an actual observer's private, single-use capability can create or renew terminal authority. */
  async finalize(id: string, proof: Permit2ObservationProof, mode: Permit2ObservationMode): Promise<Permit2ProductionRecord> {
    const capturedMode = mode, capability = proof;
    const r = await this.#required(id), j = r.exposureJournal;
    if (j === undefined || !j.holdConfirmed || r.terminal) blocked();
    const checked = await consumePermit2ObservationProof(capability, r, j.signed, capturedMode);
    if (checked.outcome === "hold" || checked.reason !== "checked" || checked.blockNumber === null || checked.blockHash === null ||
        checked.outcome !== (capturedMode === "settlement" ? "settled" : "expired_unused")) blocked();
    const body = { outcome: checked.outcome, operationDigest: checked.operationDigest, materialHash: checked.materialHash,
      requestHash: checked.requestHash, challengeHash: checked.challengeHash, signedHash: checked.signedHash,
      transactionHash: checked.transactionHash, blockNumber: checked.blockNumber, blockHash: checked.blockHash, observation: checked };
    const intent: Permit2TerminalIntent = { ...body, outcomeDigest: productionTerminalDigest(r, body) };
    const pending = await this.state.withLocks(this.#locks(r), async () => {
      const current = await this.#required(id), journal = current.exposureJournal;
      if (journal === undefined || current.terminal || canonicalJson(journal.signed) !== canonicalJson(j.signed)) blocked();
      if (journal.terminalIntent !== null) {
        if (journal.terminalIntent.outcomeDigest !== intent.outcomeDigest) blocked(); return current;
      }
      return this.#save(current, { ...journal, terminalIntent: intent }, "terminal_pending");
    });
    const lease = await this.#lease(pending), terminal = intent.outcome === "settled" ? "finalized" : "released_unsubmitted";
    if (lease.state !== terminal) await this.usage.transition({ ...productionUsageIdentity(pending), reservationId: pending.usageReservationId,
      policyDigest: pending.material.owner.policyDigest, state: terminal, outcomeDigest: intent.outcomeDigest,
      expectedCurrentStates: ["unknown_finality"], now: this.#now() });
    return this.reconcileTerminal(id);
  }
  /** Persisted intent is sufficient ONLY to match an already-terminal ledger, never to decide a new transition. */
  async reconcileTerminal(id: string): Promise<Permit2ProductionRecord> {
    const r = await this.#required(id), intent = r.exposureJournal?.terminalIntent;
    if (intent == null || r.terminal) return r;
    const lease = await this.#lease(r), state = intent.outcome === "settled" ? "finalized" : "released_unsubmitted";
    if (lease.state !== state) return r;
    if (lease.outcomeDigest !== intent.outcomeDigest) blocked();
    return this.state.withLocks(this.#locks(r), async () => {
      const current = await this.#required(id), j = current.exposureJournal;
      if (j?.terminalIntent?.outcomeDigest !== intent.outcomeDigest) blocked();
      if (current.terminal) return current;
      return this.#save(current, j, intent.outcome === "settled" ? "settled" : "expired_no_effect", true);
    });
  }
}
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 exposure lifecycle remains held or its binding changed."); }

/** These repository-owned JSON snapshots are retained only by the approved path. */
function freezeApprovedSnapshot(value: unknown): void {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeApprovedSnapshot(child);
    Object.freeze(value);
  }
}
