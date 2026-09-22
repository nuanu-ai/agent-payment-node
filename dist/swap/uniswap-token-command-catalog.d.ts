import type { CommandDefinition, CommandGroup } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const UNISWAP_TOKEN_COMMAND_GROUPS: readonly CommandGroup[];
export declare const UNISWAP_TOKEN_COMMANDS: readonly [CommandDefinition, CommandDefinition, CommandDefinition, CommandDefinition, CommandDefinition, CommandDefinition];
export declare function bindUniswapTokenCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest;
