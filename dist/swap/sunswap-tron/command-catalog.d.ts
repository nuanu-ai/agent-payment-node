import type { CommandDefinition, CommandGroup } from "../../command-catalog.js";
import type { CommandRequest } from "../../commands.js";
export declare const SUNSWAP_COMMAND_GROUPS: readonly CommandGroup[];
export declare const SUNSWAP_COMMANDS: readonly CommandDefinition[];
export declare function bindSunSwapCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest;
