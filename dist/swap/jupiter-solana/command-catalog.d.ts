import type { CommandDefinition, CommandGroup } from "../../command-catalog.js";
import type { CommandRequest } from "../../commands.js";
export declare const JUPITER_COMMAND_GROUPS: readonly CommandGroup[];
export declare const JUPITER_COMMANDS: readonly CommandDefinition[];
export declare function bindJupiterCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest;
