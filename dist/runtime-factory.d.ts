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
export declare function executeBoundCommand(bound: BoundCommand, options?: RuntimeFactoryOptions): Promise<OutputEnvelope>;
export declare function effectiveStateRoot(): string;
