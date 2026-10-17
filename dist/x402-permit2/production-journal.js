import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { OperationService } from "../operation-service.js";
import { assertPermit2OwnerLocked } from "./production-owner-admission.js";
import { StateStore } from "../state.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { Permit2ProductionPreparation } from "./production-prepare.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { Permit2ProductionRepository, productionRecordBody, productionUsageIdentity, productionUsageKey, sealPermit2ProductionRecord } from "./production-repository.js";
import { validatePermit2ProductionSigned } from "./production-signed.js";
import { consumePermit2ObservationProof } from "./production-observer.js";
import { JOURNAL_SCHEMA, productionApprovalFingerprint, productionRiskBinding, productionTerminalDigest } from "./production-journal-codec.js";
import { assertPermit2ApprovalCurrent, permit2Now } from "./production-approval-provenance.js";
import { assertSigningLifecycle, checkedSigningLease, permit2SavedIdentity } from "./production-signing-owner.js";
/** Storage/accounting only. No key, signing, transport or execution permission is returned. */
export class Permit2ProductionJournal extends Permit2ProductionRepository {
    preparation;
    clock;
    /**
     * Writes attempt 1, the single durable request marker, for the saved signed bundle the origin names, while its paid
     * approval is current. `first` is true only for the call that wrote it: only that call may send.
     */
    async markFirstRequest(origin, clock) {
        const id = origin.approval.operationId;
        if (origin.approval.purpose !== "sign-and-submit-once")
            blocked();
        const check = async (r) => {
            assertSigningLifecycle(r, "dispatch");
            assertSignedOrigin(origin, r, checkedSigningLease(r, await this.#lease(r), "dispatch"));
            assertPermit2ApprovalCurrent(origin.approval, r, permit2Now(clock));
        };
        const r = await this.#required(id);
        await check(r);
        return this.state.withLocks(this.#locks(r), async () => {
            const current = await this.#required(id);
            await check(current);
            const j = current.exposureJournal;
            if (j.request !== null)
                return Object.freeze({ record: current, first: false });
            const next = await this.#save(current, { ...j, request: { attempt: 1, requestHash: current.material.checked.requestHash,
                    headerHash: j.signed.headerHash } }, "request_pending");
            assertPermit2ApprovalCurrent(origin.approval, next, permit2Now(clock));
            freezeApprovedSnapshot(next);
            return Object.freeze({ record: next, first: true });
        });
    }
    state;
    usage;
    constructor(root, preparation, clock = () => new Date()) {
        super(root);
        this.preparation = preparation;
        this.clock = clock;
        if (preparation.records.root !== this.root)
            blocked();
        this.state = new StateStore(root);
        this.usage = new AssetUsageLedger(root);
    }
    /**
     * R4 exit of an authorization never exposed: once its deadline has passed (by the family clock), the family's own
     * expiry release proves it unsigned, frees its usage hold and ends it `released_unsubmitted`; before that it refuses.
     */
    async releaseUnexposedExpired(id) { return await this.preparation.releaseExpired(id); }
    #now() {
        const at = this.clock();
        if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < 0)
            blocked();
        return new Date(at.getTime());
    }
    #locks(r) {
        return [`profile:${r.profileHash}`, `operation:${r.operationId}`, evmAddressLock(r.material.wallet.account)];
    }
    async #required(id) {
        const r = await Permit2ProductionRepository.findOwnedOperation(this, id);
        if (r === null)
            blocked();
        return r;
    }
    async #lease(r) {
        const value = (await this.usage.usageWithReservation(productionUsageIdentity(r), r.usageReservationId, this.#now())).reservation;
        if (value === null || value.reservationId !== r.usageReservationId || value.policyDigest !== r.material.owner.policyDigest ||
            value.registryVersion !== r.material.checkpoint.registryVersion || value.rail !== "x402" ||
            value.amountAtomic !== reconstructPermit2ProductionMaterial(r.material).amountAtomic ||
            value.idempotencyHash !== sha256(`asset-usage-idempotency\0${productionUsageKey(r.operationId)}`))
            blocked();
        return value;
    }
    async #save(r, j, state = r.state, terminal = r.terminal) {
        const next = sealPermit2ProductionRecord({ ...productionRecordBody(r), exposureJournal: j,
            state, terminal, updatedAt: this.#now().toISOString() });
        await this.#persistExposureLocked(next);
        return next;
    }
    async #persistExposureLocked(r) { await Permit2ProductionRepository.persistOwnedExposure(this, r); }
    /** Initial admission checks current owner. Replays can only reconcile the existing durable hold. */
    async markSignatureRisk(id) { return (await this.#markRisk(id)).record; }
    /**
     * The first exposure under the owner's current foreground approval. Only the call that writes it receives a signing
     * continuation; every replay, and any exposure written without an approval, gets status only.
     */
    async markApprovedSignatureRisk(id, approval) {
        const result = await this.#markRisk(id, approval);
        if (result.risk === null) {
            freezeApprovedSnapshot(result.record);
            return Object.freeze({ record: result.record, continuation: null });
        }
        const risk = result.risk;
        return await this.state.withLocks(this.#locks(result.record), async () => {
            const current = await this.#required(id);
            assertSigningLifecycle(current, "exposed");
            if (current.material.materialHash !== risk.material.materialHash || current.exposureAt !== risk.exposureAt ||
                current.exposureJournal?.bindingHash !== risk.exposureJournal?.bindingHash)
                blocked();
            const lease = checkedSigningLease(current, await this.#lease(current), "exposed");
            assertPermit2ApprovalCurrent(approval, current, this.#now());
            freezeApprovedSnapshot(current);
            return Object.freeze({ record: current, continuation: Object.freeze({ approval, saved: permit2SavedIdentity(current, lease) }) });
        });
    }
    async #markRisk(id, approval) {
        await this.ready();
        const first = await this.#required(id);
        let risk = null;
        if (first.exposureJournal !== undefined)
            return { record: await this.#confirmHold(id), risk: null };
        const admitted = await this.#admitFirstRisk(id);
        if (admitted === null)
            return { record: await this.#confirmHold(id), risk: null };
        const { r, usage, lease } = admitted;
        await this.state.withLocks(this.#locks(r), async () => {
            const current = await this.#required(id);
            if (current.exposureJournal !== undefined)
                return;
            if (current.integrityHash !== r.integrityHash)
                blocked();
            const at = this.#now();
            if (BigInt(Math.floor(at.getTime() / 1000)) >= BigInt(reconstructPermit2ProductionMaterial(current.material).expiresAtUnix))
                blocked();
            const used = BigInt(usage.snapshot.amountAtomic) - BigInt(lease.amountAtomic);
            if (used < 0n)
                blocked();
            await assertPermit2OwnerLocked(this.state, new OperationService(this.state), current, at, used.toString());
            const p = reconstructPermit2ProductionMaterial(current.material);
            const journal = { schemaVersion: JOURNAL_SCHEMA,
                approvalFingerprint: productionApprovalFingerprint(current), bindingHash: productionRiskBinding(current),
                permit2Deadline: p.plan.authorization.deadline, eip2612Deadline: p.plan.eip2612?.info.deadline ?? null,
                holdConfirmed: false, signed: null, request: null, terminalIntent: null };
            const next = sealPermit2ProductionRecord({ ...productionRecordBody(current), state: "exposure_unknown",
                exposureAt: at.toISOString(), updatedAt: at.toISOString(), exposureJournal: journal });
            if (approval !== undefined)
                assertPermit2ApprovalCurrent(approval, current, this.#now());
            await this.#persistExposureLocked(next);
            if (approval !== undefined)
                risk = next;
        });
        return { record: await this.#confirmHold(id), risk };
    }
    /** Owner admission of the first exposure, read outside the locks. A caller whose first read predates a concurrent first
     * exposure sees that exposure (or its confirmed hold) here; it is then a replay of the durable hold, exactly as if it had
     * started later, and gets null. Any refusal without a durable exposure stands. */
    async #admitFirstRisk(id) {
        try {
            const r = await this.preparation.assertCurrentOwner(id);
            const usage = await this.usage.usageWithReservation(productionUsageIdentity(r), r.usageReservationId, this.#now());
            const lease = await this.#lease(r);
            if (r.state !== "reserved" || lease.state !== "reserved" || lease.reservationDigest !== r.usageReservationDigest)
                blocked();
            return { r, usage, lease };
        }
        catch (error) {
            if ((await this.#required(id)).exposureJournal !== undefined)
                return null;
            throw error;
        }
    }
    /** No state locks span ledger I/O; risk remains durable if either side fails. */
    async confirmHold(id) { return this.#confirmHold(id); }
    async #confirmHold(id) {
        const r = await this.#required(id), j = r.exposureJournal;
        if (j === undefined)
            blocked();
        if (r.terminal || j.terminalIntent !== null)
            return r;
        const lease = await this.#lease(r);
        if (!["reserved", "unknown_finality"].includes(lease.state))
            blocked();
        if (lease.state === "reserved")
            await this.usage.transition({ ...productionUsageIdentity(r), reservationId: r.usageReservationId,
                policyDigest: r.material.owner.policyDigest, state: "unknown_finality", expectedCurrentStates: ["reserved", "unknown_finality"], now: this.#now() });
        return this.state.withLocks(this.#locks(r), async () => {
            const current = await this.#required(id), journal = current.exposureJournal;
            if (journal === undefined || journal.bindingHash !== j.bindingHash)
                blocked();
            if (current.terminal || journal.terminalIntent !== null || journal.holdConfirmed)
                return current;
            return this.#save(current, { ...journal, holdConfirmed: true });
        });
    }
    async storeSigned(id, value) { return this.#storeSigned(id, value); }
    async #storeSigned(id, value) {
        const snapshot = JSON.parse(canonicalJson(value));
        const r = await this.#required(id), signed = await validatePermit2ProductionSigned(snapshot, r);
        return this.state.withLocks(this.#locks(r), async () => {
            const current = await this.#required(id), j = current.exposureJournal;
            if (j === undefined || !j.holdConfirmed || current.terminal || j.terminalIntent !== null)
                blocked();
            if (j.signed !== null) {
                if (canonicalJson(j.signed) !== canonicalJson(signed))
                    blocked();
                return current;
            }
            return this.#save(current, { ...j, signed });
        });
    }
    /** Attempt 1 is the sole durable request marker; it conveys no HTTP permission. */
    async markRequestPending(id) {
        const r = await this.#required(id);
        return this.state.withLocks(this.#locks(r), async () => {
            const current = await this.#required(id), j = current.exposureJournal;
            if (j === undefined || !j.holdConfirmed || j.signed === null || current.terminal || j.terminalIntent !== null)
                blocked();
            if (j.request !== null)
                return current;
            return this.#save(current, { ...j, request: { attempt: 1, requestHash: current.material.checked.requestHash,
                    headerHash: j.signed.headerHash } }, "request_pending");
        });
    }
    /** Only an actual observer's private, single-use capability can create or renew terminal authority. */
    async finalize(id, proof, mode) {
        const capturedMode = mode, capability = proof;
        const r = await this.#required(id), j = r.exposureJournal;
        if (j === undefined || !j.holdConfirmed || r.terminal)
            blocked();
        const checked = await consumePermit2ObservationProof(capability, r, j.signed, capturedMode);
        if (checked.outcome === "hold" || checked.reason !== "checked" || checked.blockNumber === null || checked.blockHash === null ||
            checked.outcome !== (capturedMode === "settlement" ? "settled" : "expired_unused"))
            blocked();
        const body = { outcome: checked.outcome, operationDigest: checked.operationDigest, materialHash: checked.materialHash,
            requestHash: checked.requestHash, challengeHash: checked.challengeHash, signedHash: checked.signedHash,
            transactionHash: checked.transactionHash, blockNumber: checked.blockNumber, blockHash: checked.blockHash, observation: checked };
        const intent = { ...body, outcomeDigest: productionTerminalDigest(r, body) };
        const pending = await this.state.withLocks(this.#locks(r), async () => {
            const current = await this.#required(id), journal = current.exposureJournal;
            if (journal === undefined || current.terminal || canonicalJson(journal.signed) !== canonicalJson(j.signed))
                blocked();
            if (journal.terminalIntent !== null) {
                if (journal.terminalIntent.outcomeDigest !== intent.outcomeDigest)
                    blocked();
                return current;
            }
            return this.#save(current, { ...journal, terminalIntent: intent }, "terminal_pending");
        });
        const lease = await this.#lease(pending), terminal = intent.outcome === "settled" ? "finalized" : "released_unsubmitted";
        if (lease.state !== terminal)
            await this.usage.transition({ ...productionUsageIdentity(pending), reservationId: pending.usageReservationId,
                policyDigest: pending.material.owner.policyDigest, state: terminal, outcomeDigest: intent.outcomeDigest,
                expectedCurrentStates: ["unknown_finality"], now: this.#now() });
        return this.reconcileTerminal(id);
    }
    /** Persisted intent is sufficient ONLY to match an already-terminal ledger, never to decide a new transition. */
    async reconcileTerminal(id) {
        const r = await this.#required(id), intent = r.exposureJournal?.terminalIntent;
        if (intent == null || r.terminal)
            return r;
        const lease = await this.#lease(r), state = intent.outcome === "settled" ? "finalized" : "released_unsubmitted";
        if (lease.state !== state)
            return r;
        if (lease.outcomeDigest !== intent.outcomeDigest)
            blocked();
        return this.state.withLocks(this.#locks(r), async () => {
            const current = await this.#required(id), j = current.exposureJournal;
            if (j?.terminalIntent?.outcomeDigest !== intent.outcomeDigest)
                blocked();
            if (current.terminal)
                return current;
            return this.#save(current, j, intent.outcome === "settled" ? "settled" : "expired_no_effect", true);
        });
    }
}
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 exposure lifecycle remains held or its binding changed."); }
/** The saved record still carries the origin's signed bundle under the same lease and wallet binding. */
export function assertSignedOrigin(origin, record, lease) {
    if (record.operationId !== origin.approval.operationId || record.exposureJournal?.signed?.signedHash !== origin.signedHash ||
        lease.reservationDigest !== origin.leaseDigest || sha256(canonicalJson(record.material.wallet)) !== origin.walletHash)
        blocked();
}
/** These repository-owned JSON snapshots are retained only by the approved path. */
function freezeApprovedSnapshot(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            freezeApprovedSnapshot(child);
        Object.freeze(value);
    }
}
//# sourceMappingURL=production-journal.js.map