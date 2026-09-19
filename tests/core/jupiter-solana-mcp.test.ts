import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { temporaryState } from "./helpers.js";

test("Jupiter MCP approval and execution hand off to the foreground CLI without side effects", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const server = createMcpServer({ stateRoot: temporary.root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-jupiter-mcp-handoff", version: "1.0.0" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name: string): Promise<OutputEnvelope> => {
    const result = await client.callTool({ name, arguments: { operation: "b".repeat(64) } });
    const content = result.content[0]; if (content?.type !== "text") throw new Error("expected text");
    return JSON.parse(content.text) as OutputEnvelope;
  };
  for (const action of ["approve", "execute"] as const) {
    const refused = await call(`apn_swap_solana_jupiter_${action}`);
    assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal(refused.error?.details?.cli_handoff, `apn swap solana jupiter ${action} --operation ${"b".repeat(64)}`);
    assert.equal(refused.error?.details?.foreground_auth, true);
  }
});
