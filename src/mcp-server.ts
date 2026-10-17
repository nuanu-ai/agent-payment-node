import { randomUUID } from "node:crypto";
import { ProtocolError, ProtocolErrorCode, Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { bindMcpInput } from "./command-binder.js";
import type { OutputEnvelope } from "./commands.js";
import { PRODUCT_VERSION } from "./constants.js";
import { foregroundHandoffEnvelope } from "./mcp-foreground-handoff.js";
import { RejectingMcpPolicyApproval } from "./mcp-policy-approval.js";
import { MCP_FOREGROUND_HANDOFF, MCP_TOOLS, type ProjectedMcpTool } from "./mcp-projection.js";
import { failureEnvelope } from "./output.js";
import { executeBoundCommand, type RuntimeFactoryOptions } from "./runtime-factory.js";

export type McpRuntimeOptions = Omit<RuntimeFactoryOptions, "policy" | "policyApproval">;

export function createMcpServer(options: McpRuntimeOptions = {}): Server {
  const server = new Server(
    { name: "agent-payment-node", version: PRODUCT_VERSION },
    { capabilities: { tools: {} } },
  );
  const toolsByName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));

  server.setRequestHandler("tools/list", async () => ({
    tools: [...MCP_TOOLS, MCP_FOREGROUND_HANDOFF].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler("tools/call", async (request) => {
    if (request.params.name === MCP_FOREGROUND_HANDOFF.name) {
      return server.projectCallToolResult(mcpResult(foregroundHandoffEnvelope(MCP_FOREGROUND_HANDOFF, request.params.arguments ?? {})), undefined);
    }
    const tool = toolsByName.get(request.params.name);
    if (tool === undefined) {
      throw new ProtocolError(ProtocolErrorCode.MethodNotFound, "Unknown APN MCP tool.");
    }
    const envelope = await callTool(tool, request.params.arguments ?? {}, options);
    return server.projectCallToolResult(mcpResult(envelope), undefined);
  });
  return server;
}

export async function serveMcpStdio(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}

/** Projection admits no foreground command except a policy set, whose consent path is refused with a CLI handoff. */
async function callTool(
  tool: ProjectedMcpTool,
  input: unknown,
  options: McpRuntimeOptions,
): Promise<OutputEnvelope> {
  try {
    const bound = bindMcpInput(tool.command, input);
    const policyApproval = bound.request.command === "wallet.policy.set"
      ? new RejectingMcpPolicyApproval(bound.request)
      : undefined;
    return await executeBoundCommand(bound, {
      ...options,
      ...(policyApproval === undefined ? {} : { policyApproval }),
    });
  } catch (error) {
    return failureEnvelope("invalid", randomUUID(), error);
  }
}

function mcpResult(envelope: OutputEnvelope): {
  readonly structuredContent: OutputEnvelope;
  readonly content: Array<{ readonly type: "text"; readonly text: string }>;
  readonly isError: boolean;
} {
  return {
    structuredContent: envelope,
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    isError: !envelope.ok,
  };
}
