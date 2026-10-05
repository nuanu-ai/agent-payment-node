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
  private readonly state: StateStore;
  private readonly usage: AssetUsageLedger;
  constructor(root: string, private readonly preparation: Permit2ProductionPreparation,
    private readonly clock: () => Date = () => new Date()) {
    super(root); if (preparation.records.root !== this.root) blocked();
    this.state = new StateStore(root); this.usage = new AssetUsageLedger(root);
  }
  private now(): Date {
    const at = this.clock();
    if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < 0) blocked();
    return new Date(at.getTime());
  }
  private locks(r: Permit2ProductionRecord): string[] {
    return [`profile:${r.profileHash}`, `operation:${r.operationId}`, evmAddressLock(r.material.wallet.account)];
  }
  private async required(id: string): Promise<Permit2ProductionRecord> {
    const r = await this.findOperation(id); if (r === null) blocked(); return r;
  }
  private async lease(r: Permit2ProductionRecord): Promise<AssetUsageReservation> {
    const value = (await this.usage.usageWithReservation(productionUsageIdentity(r), r.usageReservationId, this.now())).reservation;
    if (value === null || value.reservationId !== r.usageReservationId || value.policyDigest !== r.material.owner.policyDigest ||
        value.registryVersion !== r.material.checkpoint.registryVersion || value.rail !== "x402" ||
        value.amountAtomic !== reconstructPermit2ProductionMaterial(r.material).amountAtomic ||
        value.idempotencyHash !== sha256(`asset-usage-idempotency\0${productionUsageKey(r.operationId)}`)) blocked();
    return value;
  }
  private async save(r: Permit2ProductionRecord, j: Permit2ExposureJournal, state = r.state, terminal = r.terminal): Promise<Permit2ProductionRecord> {
    const next = sealPermit2ProductionRecord({ ...productionRecordBody(r), exposureJournal: j,
      state, terminal, updatedAt: this.now().toISOString() });
    await this.persistExposureLocked(next); return next;
  }
  /** Initial admission checks current owner. Replays can only reconcile the existing durable hold. */
  async markSignatureRisk(id: string): Promise<Permit2ProductionRecord> {
    await this.ready(); let r = await this.required(id);
    if (r.exposureJournal !== undefined) return this.confirmHold(id);
    r = await this.preparation.assertCurrentOwner(id);
    const usage = await this.usage.usageWithReservation(productionUsageIdentity(r), r.usageReservationId, this.now());
    const lease = await this.lease(r);
    if (r.state !== "reserved" || lease.state !== "reserved" || lease.reservationDigest !== r.usageReservationDigest) blocked();
    await this.state.withLocks(this.locks(r), async () => {
      const current = await this.required(id);
      if (current.exposureJournal !== undefined) return;
      if (current.integrityHash !== r.integrityHash) blocked();
      const at = this.now();
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
      await this.persistExposureLocked(next);
    });
    return this.confirmHold(id);
  }
  /** No state locks span ledger I/O; risk remains durable if either side fails. */
  async confirmHold(id: string): Promise<Permit2ProductionRecord> {
    const r = await this.required(id), j = r.exposureJournal; if (j === undefined) blocked();
    if (r.terminal || j.terminalIntent !== null) return r;
    const lease = await this.lease(r);
    if (!["reserved", "unknown_finality"].includes(lease.state)) blocked();
    if (lease.state === "reserved") await this.usage.transition({ ...productionUsageIdentity(r), reservationId: r.usageReservationId,
      policyDigest: r.material.owner.policyDigest, state: "unknown_finality", expectedCurrentStates: ["reserved", "unknown_finality"], now: this.now() });
    return this.state.withLocks(this.locks(r), async () => {
      const current = await this.required(id), journal = current.exposureJournal;
      if (journal === undefined || journal.bindingHash !== j.bindingHash) blocked();
      if (current.terminal || journal.terminalIntent !== null || journal.holdConfirmed) return current;
      return this.save(current, { ...journal, holdConfirmed: true });
    });
  }
  async storeSigned(id: string, value: Permit2ProductionSigned): Promise<Permit2ProductionRecord> {
    const snapshot = JSON.parse(canonicalJson(value)) as Permit2ProductionSigned;
    const r = await this.required(id), signed = await validatePermit2ProductionSigned(snapshot, r);
    return this.state.withLocks(this.locks(r), async () => {
      const current = await this.required(id), j = current.exposureJournal;
      if (j === undefined || !j.holdConfirmed || current.terminal || j.terminalIntent !== null) blocked();
      if (j.signed !== null) { if (canonicalJson(j.signed) !== canonicalJson(signed)) blocked(); return current; }
      return this.save(current, { ...j, signed });
    });
  }
  /** Attempt 1 is the sole durable request marker; it conveys no HTTP permission. */
  async markRequestPending(id: string): Promise<Permit2ProductionRecord> {
    const r = await this.required(id);
    return this.state.withLocks(this.locks(r), async () => {
      const current = await this.required(id), j = current.exposureJournal;
      if (j === undefined || !j.holdConfirmed || j.signed === null || current.terminal || j.terminalIntent !== null) blocked();
      if (j.request !== null) return current;
      return this.save(current, { ...j, request: { attempt: 1, requestHash: current.material.checked.requestHash,
        headerHash: j.signed.headerHash } }, "request_pending");
    });
  }
  /** Only an actual observer's private, single-use capability can create or renew terminal authority. */
  async finalize(id: string, proof: Permit2ObservationProof, mode: Permit2ObservationMode): Promise<Permit2ProductionRecord> {
    const capturedMode = mode, capability = proof;
    const r = await this.required(id), j = r.exposureJournal;
    if (j === undefined || !j.holdConfirmed || r.terminal) blocked();
    const checked = await consumePermit2ObservationProof(capability, r, j.signed, capturedMode);
    if (checked.outcome === "hold" || checked.reason !== "checked" || checked.blockNumber === null || checked.blockHash === null ||
        checked.outcome !== (capturedMode === "settlement" ? "settled" : "expired_unused")) blocked();
    const body = { outcome: checked.outcome, operationDigest: checked.operationDigest, materialHash: checked.materialHash,
      requestHash: checked.requestHash, challengeHash: checked.challengeHash, signedHash: checked.signedHash,
      transactionHash: checked.transactionHash, blockNumber: checked.blockNumber, blockHash: checked.blockHash, observation: checked };
    const intent: Permit2TerminalIntent = { ...body, outcomeDigest: productionTerminalDigest(r, body) };
    const pending = await this.state.withLocks(this.locks(r), async () => {
      const current = await this.required(id), journal = current.exposureJournal;
      if (journal === undefined || current.terminal || canonicalJson(journal.signed) !== canonicalJson(j.signed)) blocked();
      if (journal.terminalIntent !== null) {
        if (journal.terminalIntent.outcomeDigest !== intent.outcomeDigest) blocked(); return current;
      }
      return this.save(current, { ...journal, terminalIntent: intent }, "terminal_pending");
    });
    const lease = await this.lease(pending), terminal = intent.outcome === "settled" ? "finalized" : "released_unsubmitted";
    if (lease.state !== terminal) await this.usage.transition({ ...productionUsageIdentity(pending), reservationId: pending.usageReservationId,
      policyDigest: pending.material.owner.policyDigest, state: terminal, outcomeDigest: intent.outcomeDigest,
      expectedCurrentStates: ["unknown_finality"], now: this.now() });
    return this.reconcileTerminal(id);
  }
  /** Persisted intent is sufficient ONLY to match an already-terminal ledger, never to decide a new transition. */
  async reconcileTerminal(id: string): Promise<Permit2ProductionRecord> {
    const r = await this.required(id), intent = r.exposureJournal?.terminalIntent;
    if (intent == null || r.terminal) return r;
    const lease = await this.lease(r), state = intent.outcome === "settled" ? "finalized" : "released_unsubmitted";
    if (lease.state !== state) return r;
    if (lease.outcomeDigest !== intent.outcomeDigest) blocked();
    return this.state.withLocks(this.locks(r), async () => {
      const current = await this.required(id), j = current.exposureJournal;
      if (j?.terminalIntent?.outcomeDigest !== intent.outcomeDigest) blocked();
      if (current.terminal) return current;
      return this.save(current, j, intent.outcome === "settled" ? "settled" : "expired_no_effect", true);
    });
  }
}
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 exposure lifecycle remains held or its binding changed."); }
