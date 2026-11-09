import type { BoundCommand } from "./command-binder.js";
import type { CommandRequest, OutputEnvelope } from "./commands.js";
import { ApnCore } from "./core.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
export type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
/**
 * `runtimeCommand` selects the family runtimes and their RPC budgets: the request's own command, or for a generic
 * operation command the family command it delegates to (operation-commands.ts). Foreground approvals always follow the
 * request's own command.
 */
export declare function createApnCore(bound: BoundCommand, options?: RuntimeFactoryOptions, runtimeCommand?: CommandRequest["command"]): ApnCore;
/**
 * Every command, CLI or MCP. A command that names an operation has just read (or closed) that operation's record, or
 * at least looked it up to build its runtime, so its operation-index entry follows the record right after it, whatever
 * the command answered and even when its runtime could not be built (best effort; the next admission re-verifies). A
 * prepare refused by a blocker that provably can no longer land settles it in its own runtime and runs once more.
 */
export declare function executeBoundCommand(bound: BoundCommand, options?: RuntimeFactoryOptions): Promise<OutputEnvelope>;
/** `APN_STATE_ROOT` (a canonical absolute path) places the state of a server; otherwise it is `~/.apn` of the OS user. */
export declare function effectiveStateRoot(): string;
