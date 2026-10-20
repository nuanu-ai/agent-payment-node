import type { CommandDefinition, CommandGroup } from "../../command-catalog-types.js";
import type { CommandRequest } from "../../commands.js";
export declare const PERMIT2_ALLOWANCE_GROUPS: readonly CommandGroup[];
export declare const PERMIT2_ALLOWANCE_COMMANDS: readonly CommandDefinition[];
export declare function bindPermit2AllowanceCommand(path: string, options: Readonly<Record<string, string>>): {
    readonly request: CommandRequest;
    readonly rpcUrl?: string;
};
