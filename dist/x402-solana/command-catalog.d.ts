import type { CommandDefinition, CommandGroup } from "../command-catalog-types.js";
import type { CommandRequest } from "../commands.js";
export declare const X402_SOLANA_COMMAND_GROUPS: readonly CommandGroup[];
export declare const X402_SOLANA_COMMANDS: readonly CommandDefinition[];
export declare function bindX402SolanaCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest;
