import { type CommandDefinition } from "./command-catalog.js";
import type { CommandRequest } from "./commands.js";
export interface BoundCommand {
    readonly request: CommandRequest;
    readonly rpcUrl?: string;
    readonly bnbRpcUrl?: string;
    readonly ethereumRpcUrl?: string;
    /** `relay observe` only: the destination RPC, placed by the saved route (relay/command-route.ts). */
    readonly destinationRpcUrl?: string;
}
export declare function bindArgv(argv: readonly string[]): BoundCommand;
export declare function bindMcpInput(command: CommandDefinition, input: unknown): BoundCommand;
export declare function mcpFieldName(optionName: `--${string}`): string;
