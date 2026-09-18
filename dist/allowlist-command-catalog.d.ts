import type { CommandDefinition, CommandGroup } from "./command-catalog.js";
import type { CommandRequest } from "./commands.js";
export declare const ALLOWLIST_COMMAND_GROUPS: readonly CommandGroup[];
export declare const ALLOWLIST_COMMANDS: readonly CommandDefinition[];
export declare function bindAllowlistCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest;
