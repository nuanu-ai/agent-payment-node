import type { CommandDefinition } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const GASLESS_COMMANDS: readonly CommandDefinition[];
export declare function includeGaslessRecovery(commands: readonly CommandDefinition[]): readonly CommandDefinition[];
export declare function bindGaslessCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest;
