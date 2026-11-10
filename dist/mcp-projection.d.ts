import { type CommandDefinition } from "./command-catalog.js";
import { type ForegroundHandoffTool } from "./mcp-foreground-handoff.js";
/** Foreground commands with no handoff, by design: MCP exposes no prepare, quote or status tool of their families, so an
 * MCP agent never holds their inputs or operations, and each family starts and ends in the CLI. Every other foreground
 * command of the catalog is selected above; a test keeps this partition exact. */
export declare const CLI_ONLY_FOREGROUND: readonly ["stargate native execute", "stargate token execute", "stargate token cleanup", "relay execute", "relay retire", "wallet metamask native-transfer", "circle approval execute", "circle source submit", "sei funding approve", "mega funding approve"];
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
