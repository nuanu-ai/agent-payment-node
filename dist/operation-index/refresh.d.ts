import { SecureStateStore } from "../secure-state-store.js";
/**
 * Best effort, after a command learned an operation's truth (its status, observation, recovery, receipt or exit):
 * that operation's index entry follows its record now instead of at the next admission that meets it. Anything other
 * than an operation ID is ignored, and a failure (an invalid state root included) never reaches the command.
 */
export declare function refreshOperationIndex(state: SecureStateStore | string, operationId: unknown): Promise<void>;
