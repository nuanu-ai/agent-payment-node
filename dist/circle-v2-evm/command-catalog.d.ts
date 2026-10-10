import type { CommandDefinition, CommandGroup } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const CIRCLE_EVM_GROUPS: readonly CommandGroup[];
export declare const CIRCLE_EVM_COMMANDS: readonly CommandDefinition[];
export declare function bindCircleEvmCommand(path: string, input: Readonly<Record<string, string>>): CommandRequest;
