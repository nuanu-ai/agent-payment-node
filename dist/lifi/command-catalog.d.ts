import type { CommandDefinition } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
export declare const BRIDGE_COMMANDS: readonly CommandDefinition[];
export declare function includeBridgeRecovery(commands: readonly CommandDefinition[]): readonly CommandDefinition[];
export declare function bindBridgeCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest;
