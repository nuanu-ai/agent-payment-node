import { isPlainRecord } from "./canonical.js";
import type { CommandOutcome } from "./commands.js";

/** A family's approve step, such as `apn pay transfer approve --operation <id>` or `apn gasless transfer approve --operation <id>`. */
const APPROVE_COMMAND = /^apn (?:[a-z0-9-]+ )+approve(?: |$)/u;

/**
 * `apn operation status` of a transfer still stored as `awaiting_approval` once its approval deadline has passed. Its
 * family's approve refuses it from that instant (direct EVM and Base USDC, provider direct, Solana, TRON and the four
 * gasless families), so it can never be approved: the status presents it as `expired`, with the reason the direct approve
 * records for it (`approval_window_expired`), and names no approve step. Status stays a pure read: the stored record keeps
 * `awaiting_approval` (shown as `stored_state`) until its family ends it, and a receipt, derived from the stored record
 * and hashed, never carries this presentation. Any other outcome, and a deadline that does not parse, is returned as is.
 */
export function presentExpiredApproval(outcome: CommandOutcome, deadline: string | null, now: Date): CommandOutcome {
  const view = outcome.operation;
  if (deadline === null || !(now.getTime() >= Date.parse(deadline)) || !isPlainRecord(view) || view.state !== "awaiting_approval") return outcome;
  const actions = view.next_actions;
  if (!Array.isArray(actions)) return outcome;
  const unapproved = (action: unknown) => typeof action !== "string" || !APPROVE_COMMAND.test(action);
  return { ...outcome, operation: { ...view, state: "expired", stored_state: "awaiting_approval", reason: "approval_window_expired",
    next_actions: actions.filter(unapproved) }, nextActions: outcome.nextActions.filter(unapproved) };
}
