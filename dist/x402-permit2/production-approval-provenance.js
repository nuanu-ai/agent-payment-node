import { ApnError } from "../errors.js";
import { Permit2ProductionRepository } from "./production-repository.js";
import { assertSigningLifecycle } from "./production-signing-owner.js";
import { assertSigningTime } from "./production-signing-facts.js";
import { permit2ApprovalDisplay } from "./production-approval.js";
/** How long a foreground approval may be used after the owner completed it. */
export const PERMIT2_APPROVAL_WINDOW_MS = 60_000;
/** Shows one reserved operation at the foreground prompt; no key, signing or transport is involved. */
export class Permit2ForegroundApprovalAuthority {
    #records;
    #approval;
    #clock;
    constructor(root, approval, clock) {
        this.#records = new Permit2ProductionRepository(root);
        this.#approval = approval;
        this.#clock = clock;
    }
    async approveOwned(id, purpose = "sign-only") {
        const record = await this.#records.findOperation(id);
        if (record === null)
            blocked();
        assertSigningLifecycle(record, "reserved");
        assertSigningTime(record, permit2Now(this.#clock));
        const display = permit2ApprovalDisplay(record, purpose), started = permit2Now(this.#clock).getTime();
        await this.#approval.approve(display);
        const completedAt = permit2Now(this.#clock).getTime();
        if (completedAt < started)
            blocked();
        assertSigningTime(record, new Date(completedAt));
        return Object.freeze({ operationId: id, purpose: display.purpose, materialHash: record.material.materialHash,
            displayHash: display.displayHash, fingerprint: display.fingerprint, completedAt });
    }
}
/** The approval names exactly what `record` displays and is at most 60 s old at `at`; returns `at`. */
export function assertPermit2ApprovalCurrent(approval, record, at) {
    if (approval.operationId !== record.operationId || approval.materialHash !== record.material.materialHash)
        blocked();
    const display = permit2ApprovalDisplay(record, approval.purpose);
    if (display.displayHash !== approval.displayHash || display.fingerprint !== approval.fingerprint)
        blocked();
    assertPermit2ApprovalWindow(approval, at);
    assertSigningTime(record, at);
    return at;
}
/** The approval is at most 60 s old at `at`, and `at` is not before it. */
export function assertPermit2ApprovalWindow(approval, at) {
    const ms = at.getTime();
    if (!Number.isSafeInteger(ms) || ms < approval.completedAt || ms - approval.completedAt > PERMIT2_APPROVAL_WINDOW_MS)
        blocked();
}
export function permit2Now(clock) {
    const at = clock();
    if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < 0)
        blocked();
    return new Date(at.getTime());
}
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 foreground approval is not current or bound to this operation."); }
//# sourceMappingURL=production-approval-provenance.js.map