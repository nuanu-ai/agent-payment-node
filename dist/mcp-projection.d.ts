import { type CommandDefinition } from "./command-catalog.js";
export interface ProjectedMcpTool {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: Record<string, JsonValue>;
        readonly required: string[];
        readonly additionalProperties: false;
    };
    readonly command: CommandDefinition;
}
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export declare function projectMcpTools(manifest?: unknown): readonly ProjectedMcpTool[];
export declare const MCP_TOOLS: readonly ProjectedMcpTool[];
export {};
