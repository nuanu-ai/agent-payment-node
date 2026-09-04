import { randomUUID } from "node:crypto";
import { ProtocolError, ProtocolErrorCode, Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { bindMcpInput } from "./command-binder.js";
import { cliHandoffDetails, createCliHandoff, type CliHandoff } from "./cli-handoff.js";
import type { OutputEnvelope } from "./commands.js";
import { PRODUCT_VERSION } from "./constants.js";
import { RejectingMcpPolicyApproval } from "./mcp-policy-approval.js";
import { MCP_TOOLS, type ProjectedMcpTool } from "./mcp-projection.js";
import { RejectingMcpTransferApproval } from "./mcp-transfer-approval.js";
import { failureEnvelope } from "./output.js";
import { executeBoundCommand, type RuntimeFactoryOptions } from "./runtime-factory.js";
import { ApnError } from "./errors.js";

export type McpRuntimeOptions = Omit<RuntimeFactoryOptions, "policy" | "policyApproval">;

export function createMcpServer(options: McpRuntimeOptions = {}): Server {
  const server = new Server(
    { name: "agent-payment-node", version: PRODUCT_VERSION },
    { capabilities: { tools: {} } },
  );
  const toolsByName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));

  server.setRequestHandler("tools/list", async () => ({
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler("tools/call", async (request) => {
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

async function callTool(
  tool: ProjectedMcpTool,
  input: unknown,
  options: McpRuntimeOptions,
): Promise<OutputEnvelope> {
  try {
    const bound = bindMcpInput(tool.command, input);
    if (bound.request.command === "wallet.connect") {
      const handoff = walletConnectHandoff(bound.request);
      return failureEnvelope(bound.request.command, randomUUID(), new ApnError(
        "APN_FOREGROUND_AUTH_REQUIRED",
        "Wallet provider authentication must continue in the foreground CLI.",
        { ...cliHandoffDetails(handoff), foreground_auth: true },
      ));
    }
    if (bound.request.command === "wallet.permission.sync") {
      const handoff = createCliHandoff([
        "apn", "wallet", "permission", "sync",
        "--profile", bound.request.profile,
        "--expected-revision", String(bound.request.expectedRevision),
      ]);
      return failureEnvelope(bound.request.command, randomUUID(), new ApnError(
        "APN_FOREGROUND_AUTH_REQUIRED",
        "MetaMask permission sync must continue in the foreground CLI.",
        {
          ...cliHandoffDetails(handoff),
          foreground_auth: true,
        },
      ));
    }
    const policyApproval = bound.request.command === "wallet.policy.set"
      ? new RejectingMcpPolicyApproval(bound.request)
      : undefined;
    if (bound.request.command === "transfer.approve") {
      if (bound.rpcUrl === undefined) throw new Error("The bound transfer approval is missing its required RPC URL.");
      const { native: _injectedNative, approval: _injectedApproval, ...sharedOptions } = options;
      return await executeBoundCommand(bound, {
        ...sharedOptions,
        approval: new RejectingMcpTransferApproval(bound.request, bound.rpcUrl),
      });
    }
    return await executeBoundCommand(bound, {
      ...options,
      ...(policyApproval === undefined ? {} : { policyApproval }),
    });
  } catch (error) {
    return failureEnvelope("invalid", randomUUID(), error);
  }
}

function walletConnectHandoff(
  request: Extract<import("./commands.js").CommandRequest, { readonly command: "wallet.connect" }>,
): CliHandoff {
  const argv = ["apn", "wallet", "connect", "--profile", request.profile, "--provider", request.providerId];
  if (request.authenticationMethod !== undefined) argv.push("--auth-method", request.authenticationMethod);
  if (request.expectedRevision !== undefined) argv.push("--expected-revision", String(request.expectedRevision));
  if (request.permissionCapUsdcAtomic !== undefined) {
    argv.push("--permission-cap-usdc-atomic", request.permissionCapUsdcAtomic);
  }
  if (request.permissionExpiresAt !== undefined) {
    argv.push("--permission-expires-at", String(request.permissionExpiresAt));
  }
  if (request.idempotencyKey !== undefined) argv.push("--idempotency-key", "<same-idempotency-key>");
  return createCliHandoff(argv);
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
