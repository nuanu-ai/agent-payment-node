import type { CommandDefinition, CommandGroup } from "../../command-catalog.js";
import type { CommandRequest } from "../../commands.js";
export declare const ORCA_COMMAND_GROUPS: readonly CommandGroup[];
export declare const ORCA_COMMANDS: readonly CommandDefinition[];
export declare function bindOrcaCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest;
