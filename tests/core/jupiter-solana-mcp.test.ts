import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
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

test("Jupiter MCP read-only surfaces preserve dormant parity without creating state", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const server = createMcpServer({ stateRoot: temporary.root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-jupiter-mcp-read-only", version: "1.0.0" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<OutputEnvelope> => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content[0]; if (content?.type !== "text") throw new Error("expected text");
    return JSON.parse(content.text) as OutputEnvelope;
  };
  const snapshot = async () => await readdir(temporary.root).catch(() => [] as string[]);
  const before = await snapshot();
  const inventory = await call("apn_swap_solana_jupiter_inventory");
  assert.equal(inventory.ok, true); assert.equal((inventory.data as any).admitted, false); assert.equal((inventory.data as any).execution, "dormant");
  const quote = await call("apn_swap_solana_jupiter_quote", {
    profile: "mcp-test", account: "11111111111111111111111111111111", to: "11111111111111111111111111111111",
    amount: "1", slippage_bps: "0", owner_slippage_cap_bps: "0",
  });
  assert.equal(quote.ok, false); assert.equal(quote.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  assert.equal(quote.error?.details?.reason, "jupiter_runtime_unavailable");
  const prepare = await call("apn_swap_solana_jupiter_prepare", { profile: "mcp-test", quote: "a".repeat(64), idempotency_key: "mcp-jupiter-1" });
  assert.equal(prepare.ok, false); assert.equal(prepare.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(prepare.error?.details?.reason, "jupiter_owner_admission_required");
  const status = await call("apn_swap_solana_jupiter_status", { operation: "b".repeat(64) });
  assert.equal(status.ok, false); assert.equal(status.error?.code, "APN_OPERATION_NOT_FOUND");
  assert.deepEqual(await snapshot(), before);
});
