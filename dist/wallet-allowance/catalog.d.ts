import type { CommandDefinition, CommandGroup } from "../command-catalog-types.js";
import type { CommandRequest } from "../commands.js";
export declare const WALLET_ALLOWANCE_GROUPS: readonly CommandGroup[];
export declare const WALLET_ALLOWANCE_COMMANDS: readonly CommandDefinition[];
export declare function bindWalletAllowanceCommand(path: string, options: Readonly<Record<string, string>>): {
    readonly request: CommandRequest;
};
