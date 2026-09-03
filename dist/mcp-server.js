import { randomUUID } from "node:crypto";
import { ProtocolError, ProtocolErrorCode, Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { bindMcpInput } from "./command-binder.js";
import { PRODUCT_VERSION } from "./constants.js";
import { RejectingMcpPolicyApproval } from "./mcp-policy-approval.js";
import { MCP_TOOLS } from "./mcp-projection.js";
import { RejectingMcpTransferApproval } from "./mcp-transfer-approval.js";
import { failureEnvelope } from "./output.js";
import { executeBoundCommand } from "./runtime-factory.js";
import { ApnError } from "./errors.js";
export function createMcpServer(options = {}) {
    const server = new Server({ name: "agent-payment-node", version: PRODUCT_VERSION }, { capabilities: { tools: {} } });
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
export async function serveMcpStdio() {
    await createMcpServer().connect(new StdioServerTransport());
}
async function callTool(tool, input, options) {
    try {
        const bound = bindMcpInput(tool.command, input);
        if (bound.request.command === "wallet.connect") {
            const handoff = walletConnectHandoff(bound.request);
            return failureEnvelope(bound.request.command, randomUUID(), new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "Wallet provider authentication must continue in the foreground CLI.", { cli_handoff: handoff, foreground_auth: true }));
        }
        if (bound.request.command === "wallet.permission.sync") {
            return failureEnvelope(bound.request.command, randomUUID(), new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "MetaMask permission sync must continue in the foreground CLI.", {
                cli_handoff: `apn wallet permission sync --profile ${bound.request.profile} --expected-revision ${bound.request.expectedRevision}`,
                foreground_auth: true,
            }));
        }
        const policyApproval = bound.request.command === "wallet.policy.set"
            ? new RejectingMcpPolicyApproval(bound.request)
            : undefined;
        if (bound.request.command === "transfer.approve") {
            if (bound.rpcUrl === undefined)
                throw new Error("The bound transfer approval is missing its required RPC URL.");
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
    }
    catch (error) {
        return failureEnvelope("invalid", randomUUID(), error);
    }
}
function walletConnectHandoff(request) {
    return `apn wallet connect --profile ${request.profile} --provider ${request.providerId}${request.authenticationMethod === undefined ? "" : ` --auth-method ${request.authenticationMethod}`}${request.expectedRevision === undefined ? "" : ` --expected-revision ${request.expectedRevision}`}${request.permissionCapUsdcAtomic === undefined ? "" : ` --permission-cap-usdc-atomic ${request.permissionCapUsdcAtomic}`}${request.permissionExpiresAt === undefined ? "" : ` --permission-expires-at ${request.permissionExpiresAt}`}${request.idempotencyKey === undefined ? "" : " --idempotency-key <same-idempotency-key>"}`;
}
function mcpResult(envelope) {
    return {
        structuredContent: envelope,
        content: [{ type: "text", text: JSON.stringify(envelope) }],
        isError: !envelope.ok,
    };
}
//# sourceMappingURL=mcp-server.js.map