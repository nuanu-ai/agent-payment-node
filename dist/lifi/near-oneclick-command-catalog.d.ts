import type { CommandDefinition } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const ONECLICK_COMMANDS: readonly CommandDefinition[];
export declare function bindOneClickCommand(path: string, o: Record<string, string>): CommandRequest;
