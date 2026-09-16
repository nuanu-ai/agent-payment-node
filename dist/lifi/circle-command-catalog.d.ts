import type { CommandDefinition } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const CIRCLE_COMMANDS: readonly CommandDefinition[];
export declare function bindCircleCommand(path: string, o: Record<string, string>): CommandRequest;
