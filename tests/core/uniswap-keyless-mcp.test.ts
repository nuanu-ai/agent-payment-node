import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { temporaryState } from "./helpers.js";

const OPERATION = "b".repeat(64);

test("MCP serves read and preparation surfaces but hands approve and execute to the foreground CLI", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const server = createMcpServer({ stateRoot: temporary.root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-keyless-mcp-test", version: "1.0.0" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name: string, args: Record<string, unknown>): Promise<OutputEnvelope> => {
    const result = await client.callTool({ name, arguments: args }), content = result.content[0];
    if (content?.type !== "text") throw new Error("expected text");
    return JSON.parse(content.text) as OutputEnvelope;
  };
  const inventory = await call("apn_swap_ethereum_uniswap_inventory", {});
  assert.equal(inventory.ok, true); assert.equal((inventory.data as any).keyless.mechanismPin.constructorKind, "sdk");
  for (const action of ["approve", "execute"]) {
    const refused = await call(`apn_swap_ethereum_uniswap_${action}`, { operation: OPERATION });
    assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal(refused.error?.details?.cli_handoff, `apn swap ethereum uniswap ${action} --operation ${OPERATION}`);
  }
  const status = await call("apn_swap_ethereum_uniswap_status", { operation: OPERATION });
  assert.equal(status.error?.code, "APN_OPERATION_NOT_FOUND");
});
