import { randomUUID } from "node:crypto";
import { ProtocolError, ProtocolErrorCode, Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { bindMcpInput } from "./command-binder.js";
import { PRODUCT_VERSION } from "./constants.js";
import { foregroundHandoffEnvelope } from "./mcp-foreground-handoff.js";
import { RejectingMcpPolicyApproval } from "./mcp-policy-approval.js";
import { MCP_FOREGROUND_HANDOFF, MCP_TOOLS, serverMcpTools } from "./mcp-projection.js";
import { isServerMode } from "./server-mode.js";
import { failureEnvelope } from "./output.js";
import { executeBoundCommand } from "./runtime-factory.js";
export function createMcpServer(options = {}) {
    const server = new Server({ name: "agent-payment-node", version: PRODUCT_VERSION }, { capabilities: { tools: {} } });
    const serverMode = isServerMode();
    const tools = serverMode ? serverMcpTools() : MCP_TOOLS;
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    server.setRequestHandler("tools/list", async () => ({
        tools: [...tools, ...(serverMode ? [] : [MCP_FOREGROUND_HANDOFF])].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        })),
    }));
    server.setRequestHandler("tools/call", async (request) => {
        if (!serverMode && request.params.name === MCP_FOREGROUND_HANDOFF.name) {
            return server.projectCallToolResult(mcpResult(foregroundHandoffEnvelope(MCP_FOREGROUND_HANDOFF, request.params.arguments ?? {})), undefined);
        }
        const tool = toolsByName.get(request.params.name);
        if (tool === undefined) {
            throw new ProtocolError(ProtocolErrorCode.MethodNotFound, "Unknown APN MCP tool.");
        }
        const envelope = await callTool(tool, request.params.arguments ?? {}, options, serverMode);
        return server.projectCallToolResult(mcpResult(envelope), undefined);
    });
    return server;
}
export async function serveMcpStdio() {
    await createMcpServer().connect(new StdioServerTransport());
}
/** Projection admits no foreground command except a policy set, whose consent path is refused with a CLI handoff.
 * In server mode every projected command runs and its consent is granted by the server's owner policy. */
export async function callTool(tool, input, options, serverMode = false) {
    try {
        const bound = bindMcpInput(tool.command, input);
        const policyApproval = !serverMode && bound.request.command === "wallet.policy.set"
            ? new RejectingMcpPolicyApproval(bound.request)
            : undefined;
        return await executeBoundCommand(bound, {
            ...options,
            ...(policyApproval === undefined ? {} : { policyApproval }),
        });
    }
    catch (error) {
        return failureEnvelope("invalid", randomUUID(), error);
    }
}
export function mcpResult(envelope) {
    return {
        structuredContent: envelope,
        content: [{ type: "text", text: JSON.stringify(envelope) }],
        isError: !envelope.ok,
    };
}
//# sourceMappingURL=mcp-server.js.map