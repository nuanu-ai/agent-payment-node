import { type CommandDefinition } from "./command-catalog.js";
import type { CommandRequest } from "./commands.js";
export interface BoundCommand {
    readonly request: CommandRequest;
    readonly rpcUrl?: string;
}
export declare function bindArgv(argv: readonly string[]): BoundCommand;
export declare function bindMcpInput(command: CommandDefinition, input: unknown): BoundCommand;
export declare function mcpFieldName(optionName: `--${string}`): string;
