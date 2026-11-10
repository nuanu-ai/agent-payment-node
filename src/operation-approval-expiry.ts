import { isPlainRecord } from "./canonical.js";
import type { CommandOutcome } from "./commands.js";
import { UNSTARTED_DEADLINE_MARGIN_MS } from "./unstarted-deadline.js";

/**
 * A record still awaiting the owner's approval, as its family's adapter describes it: the instant from which its approve
 * refuses, and what ends the record once that instant has passed.
 */
export interface ApprovalExpiry {
  /** Epoch milliseconds from which the family's approve refuses this record. */
  readonly deadlineMs: number;
  /** True when that approve now closes the record as failed_before_effect without asking anything: it stays named. */
  readonly approveCloses: boolean;
  /** What ends the record, in plain words. */
  readonly note: string;
}

/** Direct (Base USDC, provider), Solana, TRON and local x402: approve checks the deadline before any prompt and closes. */
export const EXPIRED_APPROVE_CLOSES = "The approval window has passed, so approve no longer approves anything: running it now closes this " +
  "operation as failed_before_effect, with no prompt, and nothing is signed or sent. Until then the operation stays open.";
/** Local EVM direct: the next transfer the profile prepares on the chain retires it (TransferService.retireExpiredDirectTransfers). */
export const EXPIRED_NEXT_TRANSFER_CLOSES = "The approval window has passed and this transfer can no longer be approved; nothing was signed or " +
  "sent. The next transfer this profile prepares on this chain closes it as failed_before_effect.";
/** Gasless and swap: the index stops counting an unstarted record once the unstarted margin has passed its deadline. */
export const EXPIRED_RELEASED_AFTER_MARGIN = "The approval window has passed and this operation can no longer be approved; nothing was signed " +
  `or sent. It stops holding its account ${UNSTARTED_DEADLINE_MARGIN_MS / 60_000} minutes after the window closed, with nothing to run.`;

/** A family's approve step, such as `apn pay transfer approve --operation <id>` or `apn gasless transfer approve --operation <id>`. */
const APPROVE_COMMAND = /^apn (?:[a-z0-9-]+ )+approve(?: |$)/u;

/**
 * `apn operation status` of a record still stored as `awaiting_approval` once its approval deadline has passed: it can
 * never be approved, so the status presents it as `expired` with the reason the direct approve records for it
 * (`approval_window_expired`) and `expiry_note` saying what ends it. Its approve step stays named only where running it
 * now closes the record without asking anything. Status stays a pure read: the stored record keeps `awaiting_approval`
 * (shown as `stored_state`) until its family ends it, and a receipt, derived from the stored record and hashed, never
 * carries this presentation. Any other outcome is returned as is.
 */
export function presentExpiredApproval(outcome: CommandOutcome, expiry: ApprovalExpiry | null, now: Date): CommandOutcome {
  const view = outcome.operation;
  if (expiry === null || !(now.getTime() >= expiry.deadlineMs) || !isPlainRecord(view) || view.state !== "awaiting_approval") return outcome;
  const expired = { ...view, state: "expired", stored_state: "awaiting_approval", reason: "approval_window_expired", expiry_note: expiry.note };
  if (expiry.approveCloses) return { ...outcome, operation: expired };
  const unapproved = (action: unknown) => typeof action !== "string" || !APPROVE_COMMAND.test(action);
  const actions = view.next_actions;
  return { ...outcome, operation: Array.isArray(actions) ? { ...expired, next_actions: actions.filter(unapproved) } : expired,
    nextActions: outcome.nextActions.filter(unapproved) };
}
