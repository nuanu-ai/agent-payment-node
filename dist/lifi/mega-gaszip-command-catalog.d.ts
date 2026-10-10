import type { CommandDefinition } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const MEGA_FUNDING_COMMANDS: readonly CommandDefinition[];
export declare function bindMegaFundingCommand(path: string, o: Record<string, string>): CommandRequest;
