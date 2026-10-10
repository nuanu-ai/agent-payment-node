import { ApnError } from "../errors.js";
import { LocalWalletNative } from "../local-wallet-native.js";
import { Permit2ProductionRepository } from "./production-repository.js";
import { assertSigningLifecycle } from "./production-signing-owner.js";
import { assertSigningTime } from "./production-signing-facts.js";
import { permit2ApprovalDisplay } from "./production-approval.js";
const proofs = new WeakMap();
/** Trusted wiring; the only UI-proof issuer performs actual owned disclosure and foreground approval. */
export class Permit2ForegroundApprovalAuthority {
    #records;
    #approval;
    #clock;
    #binding;
    constructor(journal, controller, native, capability, approval, clock) {
        const nativeState = LocalWalletNative.assertPermit2LocalCapability(capability, native, journal.root);
        this.#approval = approval;
        this.#clock = clock;
        this.#records = new Permit2ProductionRepository(journal.root);
        this.#binding = Object.freeze({ journal, controller, native, capability, nativeState, root: journal.root });
    }
    async approveOwned(id, purpose = "sign-only") {
        const record = await this.#records.findOperation(id);
        if (record === null)
            blocked();
        assertSigningLifecycle(record, "reserved");
        assertSigningTime(record, now(this.#clock));
        const display = permit2ApprovalDisplay(record, purpose), started = now(this.#clock).getTime();
        await this.#approval.approve(display);
        const completedAt = now(this.#clock).getTime();
        if (completedAt < started)
            blocked();
        assertSigningTime(record, new Date(completedAt));
        const proof = Object.freeze({ kind: "permit2-foreground-approval-proof" });
        proofs.set(proof, { ...this.#binding, purpose: display.purpose, operationId: id, materialHash: record.material.materialHash,
            displayHash: display.displayHash, fingerprint: display.fingerprint, completedAt, clock: this.#clock, claimed: false });
        return proof;
    }
}
function checked(proof, journal, record) {
    const entry = proofs.get(proof);
    if (entry === undefined || entry.journal !== journal || entry.root !== journal.root ||
        entry.operationId !== record.operationId || entry.materialHash !== record.material.materialHash)
        blocked();
    const display = permit2ApprovalDisplay(record, entry.purpose);
    if (display.displayHash !== entry.displayHash || display.fingerprint !== entry.fingerprint ||
        LocalWalletNative.assertPermit2LocalCapability(entry.capability, entry.native, entry.root) !== entry.nativeState)
        blocked();
    const at = now(entry.clock);
    if (at.getTime() < entry.completedAt || at.getTime() - entry.completedAt > 60_000)
        blocked();
    assertSigningTime(record, at);
    return entry;
}
/** Read-only recognition before fresh RPC. Atomic claiming still occurs only under the journal's first-write locks. */
export function assertCurrentPermit2ForegroundApproval(proof, journal, record) { if (checked(proof, journal, record).claimed)
    blocked(); }
/** Recognizes only an actual privately issued UI proof; there is no caller-authoritative time. */
export function claimPermit2ForegroundApproval(proof, journal, record) {
    const entry = checked(proof, journal, record);
    if (entry.claimed)
        blocked();
    entry.claimed = true;
    const { claimed: _claimed, ...binding } = entry;
    return Object.freeze(binding);
}
export function assertClaimedPermit2ForegroundApproval(proof, journal, record) { if (!checked(proof, journal, record).claimed)
    blocked(); }
export function revokePermit2ForegroundApproval(proof) { proofs.delete(proof); }
function now(clock) { const at = clock(); if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < 0)
    blocked(); return new Date(at); }
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 foreground approval is not privately owned, current or bound."); }
//# sourceMappingURL=production-approval-provenance.js.map