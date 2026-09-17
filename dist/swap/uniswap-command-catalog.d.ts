import type { CommandDefinition, CommandGroup } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const UNISWAP_COMMAND_GROUPS: readonly CommandGroup[];
export declare const UNISWAP_COMMANDS: readonly CommandDefinition[];
export declare function bindUniswapCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest;
