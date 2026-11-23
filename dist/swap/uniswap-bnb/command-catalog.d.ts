import type { CommandDefinition, CommandGroup } from "../../command-catalog-types.js";
import type { CommandRequest } from "../../commands.js";
export declare const UNISWAP_BNB_COMMAND_GROUPS: readonly CommandGroup[];
export declare const UNISWAP_BNB_COMMANDS: readonly CommandDefinition[];
export declare function bindUniswapBnbCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest;
