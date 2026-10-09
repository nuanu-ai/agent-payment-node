import assert from "node:assert/strict";
import test from "node:test";
import { CIRCLE_EVM_COMMANDS, bindCircleEvmCommand } from "../../src/circle-v2-evm/command-catalog.js";
const id = "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
for (const action of ["cleanup85-prepare", "cleanup85-cancel", "cleanup86-approve"]) test(`finite CLI discovery ${action}`, () => {
  const command = CIRCLE_EVM_COMMANDS.find(c => c.path.join(" ") === "circle evm " + action)!;
  assert.equal(command.approval.class, action === "cleanup85-prepare" ? "none" : "foreground_tty");
  assert.deepEqual(bindCircleEvmCommand("circle evm " + action, { "--operation": id }), { command: "circle.evm." + action, operationId: id });
  for (const extra of ["--nonce", "--approve", "--value", "--transaction-hash"]) assert.throws(() => bindCircleEvmCommand("circle evm " + action, { "--operation": id, [extra]: "1" }));
  assert.throws(() => bindCircleEvmCommand("circle evm " + action, { "--operation": "a".repeat(64) }));
});

test("official MCP client discovers finite tools and financial calls return CLI handoff before runtime", async t => {
  const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client"), { createMcpServer } = await import("../../src/mcp-server.js"); let entries = 0;
  const server = createMcpServer({ circleEvm: { cancelCleanup85: async () => { entries++; }, approveCleanup86: async () => { entries++; } } as never });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport); const client = new Client({ name: "cleanup85-finite-gate", version: "1" }); await client.connect(clientTransport); t.after(async () => { await client.close(); await server.close(); });
  const listed = await client.listTools(); for (const action of ["cleanup85_prepare", "cleanup85_cancel", "cleanup86_approve"]) assert.ok(listed.tools.some(x => x.name === "apn_circle_evm_" + action));
  for (const action of ["cleanup85_cancel", "cleanup86_approve"]) {
    const result = await client.callTool({ name: "apn_circle_evm_" + action, arguments: { operation: id } }), content = result.content[0]; assert.equal(content?.type, "text"); if (content?.type !== "text") throw new Error("text required");
    const outcome = JSON.parse(content.text); assert.equal(outcome.error.code, "APN_FOREGROUND_APPROVAL_REQUIRED"); assert.match(JSON.stringify(outcome.error.details), new RegExp(action.replaceAll("_", "-")));
    const forged = await client.callTool({ name: "apn_circle_evm_" + action, arguments: { operation: id, approve: true } }), c = forged.content[0]; assert.equal(c?.type, "text"); if (c?.type === "text") assert.equal(JSON.parse(c.text).error.code, "APN_INVALID_INPUT");
  }
  assert.equal(entries, 0);
});
