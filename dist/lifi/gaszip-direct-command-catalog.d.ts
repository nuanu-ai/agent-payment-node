import type { CommandDefinition } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const SEI_FUNDING_COMMANDS: readonly CommandDefinition[];
export declare const MEGA_FUNDING_COMMANDS: readonly CommandDefinition[];
/** Binds `apn <lane> funding prepare|approve|status` for the route named by the command group. */
export declare function bindGaszipFundingCommand(path: string, o: Record<string, string>): CommandRequest;
