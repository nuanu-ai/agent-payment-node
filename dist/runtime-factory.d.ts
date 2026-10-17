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
 * the command answered and even when its runtime could not be built (best effort; the next admission re-verifies).
 */
export declare function executeBoundCommand(bound: BoundCommand, options?: RuntimeFactoryOptions): Promise<OutputEnvelope>;
export declare function effectiveStateRoot(): string;
