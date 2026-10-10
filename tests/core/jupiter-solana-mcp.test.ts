import assert from "node:assert/strict";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { OutputEnvelope } from "../../src/commands.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
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

test("Jupiter MCP read-only surfaces retain dormant V2 and fail closed for V1 without owner admission", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const payer = "GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki";
  const testStore = new ChainAccountStore(temporary.root, { async load() { return Buffer.alloc(32, 77); }, async create() { return Buffer.alloc(32, 77); } });
  await testStore.ensureLocal({ profile: "mcp-test", rail: "solana", create: async () => ({ address: payer, seed: Buffer.alloc(32, 9) }) });
  let rpcReads = 0, secretReads = 0;
  const server = createMcpServer({ stateRoot: temporary.root,
    solanaRpcFetch: async () => { rpcReads++; throw new Error("unexpected RPC"); },
    wrappingSecret: { async load() { secretReads++; throw new Error("unexpected custody read"); }, async create() { secretReads++; throw new Error("unexpected custody creation"); } },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-jupiter-mcp-read-only", version: "1.0.0" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<OutputEnvelope> => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content[0]; if (content?.type !== "text") throw new Error("expected text");
    return JSON.parse(content.text) as OutputEnvelope;
  };
  const emptyPolicy = await new AllowlistPolicyStore(temporary.root).read("mcp-test");
  assert.deepEqual(emptyPolicy.records, []); assert.deepEqual(emptyPolicy.entries, []);
  const snapshot = async () => (await readdir(temporary.root, { recursive: true })).sort();
  const before = await snapshot();
  const inventory = await call("apn_swap_solana_jupiter_inventory");
  assert.equal(inventory.ok, true); assert.equal((inventory.data as any).admitted, false); assert.equal((inventory.data as any).execution, "dormant");
  const quote = await call("apn_swap_solana_jupiter_quote", {
    profile: "mcp-test", account: payer, to: payer,
    amount: "1000000", slippage_bps: "50", owner_slippage_cap_bps: "50",
  });
  assert.equal(quote.ok, false); assert.equal(quote.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(quote.error?.details?.reason, "jupiter_v1_owner_admission");
  assert.match(quote.error?.message ?? "", /active owner policy/);
  assert.equal(rpcReads, 0); assert.equal(secretReads, 0);
  const prepare = await call("apn_swap_solana_jupiter_prepare", { profile: "mcp-test", quote: "a".repeat(64), idempotency_key: "mcp-jupiter-1" });
  assert.equal(prepare.ok, false); assert.equal(prepare.error?.code, "APN_OPERATION_NOT_FOUND");
  assert.equal(rpcReads, 0); assert.equal(secretReads, 0);
  const status = await call("apn_swap_solana_jupiter_status", { operation: "b".repeat(64) });
  assert.equal(status.ok, false); assert.equal(status.error?.code, "APN_OPERATION_NOT_FOUND");
  const initialized = ["jupiter-v1-quotes", join("jupiter-v1-quotes", "chunks")];
  assert.deepEqual(await snapshot(), [...before, ...initialized].sort());
  for (const directory of ["allowlist-policies", "allowlist-activations", join("jupiter-v1-quotes", "chunks")]) {
    assert.deepEqual(await readdir(join(temporary.root, directory)), []);
  }
  assert.deepEqual(await readdir(join(temporary.root, "jupiter-v1-quotes")), ["chunks"]);
  assert.equal(rpcReads, 0); assert.equal(secretReads, 0);
});
