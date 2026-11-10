import { isPlainRecord } from "./canonical.js";
import { UNSTARTED_DEADLINE_MARGIN_MS } from "./unstarted-deadline.js";
/** Direct (Base USDC, provider), Solana, TRON and local x402: approve checks the deadline before any prompt and closes. */
export const EXPIRED_APPROVE_CLOSES = "The approval window has passed, so approve no longer approves anything: running it now closes this " +
    "operation as failed_before_effect, with no prompt, and nothing is signed or sent. Until then the operation stays open.";
/**
 * Local EVM direct: approve closes it as it closes Base USDC, and so does the next transfer the profile prepares on the
 * chain (TransferService.retireExpiredDirectTransfers); both first pass DirectPublicEffectJournal.assertUnstarted.
 */
export const EXPIRED_APPROVE_OR_NEXT_TRANSFER_CLOSES = "The approval window has passed, so approve no longer approves anything: " +
    "running it now closes this operation as failed_before_effect, with no prompt, and nothing is signed or sent. The next transfer " +
    "this profile prepares on this chain closes it the same way.";
/** The retired cleanup85 cancellation, read-only to approve: only the next transfer the profile prepares on the chain retires it. */
export const EXPIRED_NEXT_TRANSFER_CLOSES = "The approval window has passed and this transfer can no longer be approved; nothing was signed or " +
    "sent. The next transfer this profile prepares on this chain closes it as failed_before_effect.";
/**
 * A local direct transfer without its public effect evidence (prepared before APN recorded it, or its wallet file is gone):
 * approve and the expiry retirement both stop at DirectPublicEffectJournal.assertUnstarted with direct_public_evidence_missing.
 */
export const EXPIRED_EVIDENCE_MISSING = "The approval window has passed, so this transfer can no longer be approved. APN holds no public " +
    "effect evidence for it (it was prepared before APN recorded that evidence, or its wallet file is gone), so it cannot prove nothing was " +
    "signed: approve refuses with direct_public_evidence_missing instead of closing it, and the transfer keeps holding its account until it " +
    "is resolved manually.";
/**
 * A local direct transfer whose evidence approve refuses for any other reason (DirectPublicEffectJournal.assertUnstarted: a
 * prepared binding, frozen custody or wallet that no longer matches the saved operation, signing evidence already present),
 * or a generic EVM record without its frozen native custody: approve refuses before its deadline check, and so does the
 * expiry retirement.
 */
export const EXPIRED_EVIDENCE_UNVERIFIED = "The approval window has passed, so this transfer can no longer be approved. Its public " +
    "effect evidence or wallet custody does not check out against the saved operation, so APN cannot prove nothing was signed: approve " +
    "refuses instead of closing it, and the transfer keeps holding its account until it is resolved manually.";
/**
 * A local direct transfer whose evidence check could not run to an answer (the file system refused or failed a read, such
 * as EACCES or EIO): nothing is known yet about what approve would do, so approve is not named and status is the next step.
 */
export const EXPIRED_EVIDENCE_UNREADABLE = "The approval window has passed, so this transfer can no longer be approved. APN could " +
    "not read its public effect evidence just now, so it cannot yet say whether approve would close it or refuse; nothing was signed " +
    "or sent by this status. Run status again once the APN state is readable.";
/**
 * Gasless and swap: the index stops counting an unstarted record once the unstarted margin has passed its recorded expiry
 * (a gasless approve stops being able to finish a little before that expiry, so the release is counted from the expiry).
 */
export const EXPIRED_RELEASED_AFTER_MARGIN = "The approval window has passed and this operation can no longer be approved; nothing was signed " +
    `or sent. It stops holding its account ${UNSTARTED_DEADLINE_MARGIN_MS / 60_000} minutes after its recorded expiry time, with nothing to run.`;
/** A family's approve step, such as `apn pay transfer approve --operation <id>` or `apn gasless transfer approve --operation <id>`. */
const APPROVE_COMMAND = /^apn (?:[a-z0-9-]+ )+approve(?: |$)/u;
/**
 * `apn operation status` of a record still stored as `awaiting_approval` once its approval deadline has passed: it can
 * never be approved, so the status presents `state: expired`, `stored_state: awaiting_approval`, the reason the direct
 * approve records (`approval_window_expired`) and `expiry_note` saying what ends it. These fields go on the operation view,
 * or, for a sealed slot, in the data slot beside the untouched operation. Approve stays named only where running it now
 * closes the record without asking anything. `proof_class` is left as the family set it: what the stored record proves
 * (for a swap, its stored state). Status stays a pure read: the stored record keeps `awaiting_approval` until its family
 * ends it, and a receipt, derived from the stored record and hashed, never carries this presentation. Any other outcome,
 * and a sealed one whose data slot is neither empty nor a record, is returned as is.
 */
export function presentExpiredApproval(outcome, expiry, now) {
    const view = outcome.operation, data = outcome.data;
    if (expiry === null || !(now.getTime() >= expiry.deadlineMs) || !isPlainRecord(view) || view.state !== "awaiting_approval")
        return outcome;
    const presented = { state: "expired", stored_state: "awaiting_approval", reason: "approval_window_expired", expiry_note: expiry.note };
    const unapproved = (action) => expiry.approveCloses || typeof action !== "string" || !APPROVE_COMMAND.test(action);
    const nextActions = outcome.nextActions.filter(unapproved);
    if (expiry.sealedSlot) {
        const beside = data === null ? {} : isPlainRecord(data) ? data : null;
        return beside === null ? outcome : { ...outcome, data: { ...beside, ...presented }, nextActions };
    }
    const actions = view.next_actions;
    return { ...outcome, operation: { ...view, ...presented, ...(Array.isArray(actions) ? { next_actions: actions.filter(unapproved) } : {}) },
        nextActions };
}
//# sourceMappingURL=operation-approval-expiry.js.map