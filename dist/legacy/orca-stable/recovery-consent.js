import { approvalCode } from "../../approval-code.js";
import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { exactChainConsent } from "../../tty-approval.js";
import { isOrcaStableGuardedMechanismDigest } from "./mechanism.js";
export class TtyOrcaStableConsent {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async confirm(lines, code, deadline) {
        await exactChainConsent(lines, code, deadline, this.options);
    }
}
/** Owner authorizes only the strict local proof of no send and matching principal release. */
export async function confirmOrcaStableNoSendRecovery(service, operationId, consent, clock) {
    const operation = await service.operations.loadAny(operationId);
    if (operation === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
    if (!isOrcaStableGuardedMechanismDigest(operation.mechanismDigest) ||
        !["submitting", "failed_before_effect"].includes(operation.state) ||
        operation.submissionMarker === null || operation.usageLease === null || operation.receiptProof !== null)
        blocked("Stable operation has no marked no-send recovery boundary.", "orca_stable_effect_boundary");
    const before = checkedNow(clock);
    if (before.toISOString() < operation.updatedAt)
        blocked("Stable recovery clock precedes the operation.", "orca_stable_recovery_clock");
    const deadline = new Date(before.getTime() + 60_000).toISOString();
    const lines = ["Agent Payment Node Orca stable no-send recovery", `Operation: ${operationId}`,
        `Owner: ${operation.quote.account}`, `Quote: ${operation.quote.quoteHash}`,
        `Submission marker: ${operation.submissionMarker.markerHash}`,
        `Reserved USDC principal: ${operation.usageLease.amountAtomic} atomic; reservation: ${operation.usageLease.reservationId}`,
        `Policy digest: ${operation.policyDigest}`, `Recovery deadline: ${deadline}`,
        "Release principal only after a durable marker-bound proof finds no send claim and no signed custody effect.",
        "If either exists or proof is incomplete, keep principal held. Never sign or send during recovery."];
    const code = approvalCode("swap", operationId, domainHash("apn.orca-stable-no-send-recovery-screen.v1", canonicalJson(lines)));
    await consent.confirm(lines, code, deadline);
    const after = checkedNow(clock);
    if (after.getTime() < before.getTime() || after.toISOString() >= deadline)
        blocked("Stable recovery consent expired.", "orca_stable_approval_expired");
    const latest = await service.operations.loadAny(operationId);
    if (latest === null || latest.integrityHash !== operation.integrityHash)
        blocked("Stable operation changed during recovery consent.", "orca_stable_operation_drift");
}
function checkedNow(clock) {
    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        throw new ApnError("APN_INVALID_INPUT", "Stable approval clock is invalid.");
    return now;
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=recovery-consent.js.map