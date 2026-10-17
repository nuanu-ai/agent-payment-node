import { type CommandDefinition } from "./command-catalog.js";
import { type ForegroundHandoffTool } from "./mcp-foreground-handoff.js";
export interface ProjectedMcpTool {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: Record<string, JsonValue>;
        readonly required: string[];
        readonly additionalProperties: false;
        readonly oneOf?: JsonValue[];
    };
    readonly command: CommandDefinition;
}
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export declare function projectMcpTools(manifest?: unknown): readonly ProjectedMcpTool[];
/** The one tool that names the exact foreground CLI command for every selected command MCP cannot run. */
export declare function projectMcpForegroundHandoff(manifest?: unknown): ForegroundHandoffTool;
export declare const MCP_TOOLS: readonly ProjectedMcpTool[];
export declare const MCP_FOREGROUND_HANDOFF: ForegroundHandoffTool;
export {};
