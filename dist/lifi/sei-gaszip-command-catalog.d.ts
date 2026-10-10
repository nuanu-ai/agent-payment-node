import type { CommandDefinition } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const SEI_FUNDING_COMMANDS: readonly CommandDefinition[];
export declare function bindSeiFundingCommand(path: string, o: Record<string, string>): CommandRequest;
