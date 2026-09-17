import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  ALLOWLIST_DATASET_SHA256,
  ALLOWLIST_DATASET_VERSION,
  assertAllowlistExecutionConfigured,
  loadAllowlistInventory,
  resolveAllowlistAsset,
} from "../../src/allowlist-inventory.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { temporaryState, UUID } from "./helpers.js";

const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRON = "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";

test("frozen dataset compiles to a deterministic strict inventory with no admitted rails or caps", () => {
  const inventory = loadAllowlistInventory();
  assert.equal(inventory.dataset.version, ALLOWLIST_DATASET_VERSION);
  assert.equal(inventory.dataset.sha256, ALLOWLIST_DATASET_SHA256);
  assert.match(inventory.inventorySha256, /^[a-f0-9]{64}$/u);
  assert.equal(inventory.networks.length, 13);
  assert.equal(inventory.assets.length, 28);
  assert.equal(inventory.deployments.length, 15);
  assert.equal(inventory.policyRegistry.configured, false);
  assert.equal(inventory.policyRegistry.status, "blocked_owner_caps_missing");
  assert.deepEqual(inventory.railStates.map((row) => row.admitted), [false, false, false, false, false]);
  for (const asset of inventory.assets) {
    assert.equal(asset.caps, null);
    assert.deepEqual(asset.rails, { direct: false, gasless: false, x402: false, bridge: false, swap: false });
    assert.equal(asset.admission, "not_admitted_owner_configuration_missing");
  }
  assert.equal(loadAllowlistInventory().inventorySha256, inventory.inventorySha256);
});

test("resolver selects only exact native and deployment identities across all families", () => {
  assert.equal(resolveAllowlistAsset({ chain: "eip155:1", kind: "native" }).symbol, "ETH");
  assert.equal(resolveAllowlistAsset({ chain: "eip155:1", kind: "token", identifier: ETHEREUM_USDC }).symbol, "USDC");
  assert.equal(resolveAllowlistAsset({ chain: SOLANA, kind: "token", identifier: SOLANA_USDC }).family, "solana");
  assert.equal(resolveAllowlistAsset({ chain: TRON, kind: "native" }).symbol, "TRX");
});

test("unknown chains, symbols, noncanonical addresses and native-token confusion have stable refusals", () => {
  const cases = [
    [{ chain: "eip155:999999", kind: "native" }, "APN_ALLOWLIST_UNKNOWN_CHAIN", "unknown_chain"],
    [{ chain: "eip155:1", kind: "token", identifier: "USDC" }, "APN_ALLOWLIST_IDENTITY_INVALID", "invalid_token_identifier"],
    [{ chain: "eip155:1", kind: "token", identifier: ETHEREUM_USDC.toLowerCase() }, "APN_ALLOWLIST_IDENTITY_INVALID", "invalid_token_identifier"],
    [{ chain: "eip155:1", kind: "native", identifier: ETHEREUM_USDC }, "APN_ALLOWLIST_IDENTITY_INVALID", "native_token_confusion"],
    [{ chain: "eip155:1", kind: "token", identifier: "0x0000000000000000000000000000000000000001" }, "APN_ALLOWLIST_ASSET_NOT_FOUND", "unknown_token_deployment"],
  ] as const;
  for (const [input, code, reason] of cases) {
    assert.throws(() => resolveAllowlistAsset(input as never), (error: unknown) => {
      const value = error as { code?: string; details?: { reason?: string } };
      return value.code === code && value.details?.reason === reason;
    });
  }
});

test("execution evaluation remains fail closed for every frozen rail", () => {
  for (const rail of ["direct", "gasless", "x402", "bridge", "swap"] as const) {
    assert.throws(() => assertAllowlistExecutionConfigured({ chain: "eip155:1", kind: "token", identifier: ETHEREUM_USDC, rail }),
      (error: unknown) => {
        const value = error as { code?: string; details?: { reason?: string } };
        return value.code === "APN_ALLOWLIST_NOT_ADMITTED" && value.details?.reason === "rail_not_admitted";
      });
  }
});

test("CLI and MCP inventory and exact resolution return identical JSON envelopes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ids = { next: () => UUID };
  const server = createMcpServer({ stateRoot: temporary.root, ids });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "allowlist-parity-test", version: "1.0.0" });
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  for (const row of [
    { argv: ["allowlist", "inventory"], tool: "apn_allowlist_inventory", args: {} },
    { argv: ["allowlist", "resolve", "--chain", "eip155:1", "--kind", "token", "--identifier", ETHEREUM_USDC],
      tool: "apn_allowlist_resolve", args: { chain: "eip155:1", kind: "token", identifier: ETHEREUM_USDC } },
    { argv: ["allowlist", "resolve", "--chain", "eip155:1", "--kind", "token", "--identifier", "USDC"],
      tool: "apn_allowlist_resolve", args: { chain: "eip155:1", kind: "token", identifier: "USDC" } },
  ] as const) {
    const cli = await runCli(row.argv, {}, { stateRoot: temporary.root, ids });
    const result = await client.callTool({ name: row.tool, arguments: row.args });
    const content = result.content[0]; assert.equal(content?.type, "text");
    const mcp = JSON.parse((content as { text: string }).text) as OutputEnvelope;
    assert.deepEqual(result.structuredContent, mcp);
    assert.deepEqual(mcp, cli);
  }
});
