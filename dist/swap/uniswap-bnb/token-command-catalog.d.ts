import type { CommandDefinition, CommandGroup } from "../../command-catalog-types.js";
import type { CommandRequest } from "../../commands.js";
export declare const UNISWAP_BNB_TOKEN_COMMAND_GROUPS: readonly CommandGroup[];
export declare const UNISWAP_BNB_TOKEN_COMMANDS: readonly CommandDefinition[];
export declare function bindUniswapBnbTokenCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest;
