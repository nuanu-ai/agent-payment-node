import { SecureStateStore } from "../secure-state-store.js";
import { STATE_HASH } from "./adapter.js";
import { OperationIndex } from "./index.js";

/**
 * Best effort, after a command learned an operation's truth (its status, observation, recovery, receipt or exit):
 * that operation's index entry follows its record now instead of at the next admission that meets it. Anything other
 * than an operation ID is ignored, and a failure (an invalid state root included) never reaches the command.
 */
export async function refreshOperationIndex(state: SecureStateStore | string, operationId: unknown): Promise<void> {
  if (typeof operationId !== "string" || !STATE_HASH.test(operationId)) return;
  try { await new OperationIndex(typeof state === "string" ? new SecureStateStore(state) : state).refresh(operationId); }
  catch { /* Best effort by contract. */ }
}
