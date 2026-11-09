import { Server } from "@modelcontextprotocol/server";
import type { OutputEnvelope } from "./commands.js";
import { type ProjectedMcpTool } from "./mcp-projection.js";
import { type RuntimeFactoryOptions } from "./runtime-factory.js";
export type McpRuntimeOptions = Omit<RuntimeFactoryOptions, "policy" | "policyApproval">;
export declare function createMcpServer(options?: McpRuntimeOptions): Server;
export declare function serveMcpStdio(): Promise<void>;
/** Projection admits no foreground command except a policy set, whose consent path is refused with a CLI handoff.
 * In server mode every projected command runs and its consent is granted by the server's owner policy. */
export declare function callTool(tool: ProjectedMcpTool, input: unknown, options: McpRuntimeOptions, serverMode?: boolean): Promise<OutputEnvelope>;
export declare function mcpResult(envelope: OutputEnvelope): {
    readonly structuredContent: OutputEnvelope;
    readonly content: Array<{
        readonly type: "text";
        readonly text: string;
    }>;
    readonly isError: boolean;
};
