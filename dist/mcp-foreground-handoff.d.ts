import type { CommandDefinition } from "./command-catalog-types.js";
import type { OutputEnvelope } from "./commands.js";
export declare const FOREGROUND_HANDOFF_TOOL_NAME = "apn_foreground_handoff";
export interface ForegroundHandoffTool {
    readonly name: typeof FOREGROUND_HANDOFF_TOOL_NAME;
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: Record<string, {
            [key: string]: string | string[];
        }>;
        readonly required: string[];
        readonly additionalProperties: false;
    };
    readonly commands: readonly CommandDefinition[];
}
export declare function projectForegroundHandoff(commands: readonly CommandDefinition[]): ForegroundHandoffTool;
export declare function foregroundHandoffEnvelope(tool: ForegroundHandoffTool, input: unknown): OutputEnvelope;
