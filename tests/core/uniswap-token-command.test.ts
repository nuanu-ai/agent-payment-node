import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bindArgv } from "../../src/command-binder.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const OPERATION = "b".repeat(64);

test("token-input CLI binds a separate exact six-command family without widening native Uniswap", () => {
  const paths = ["inventory", "quote", "prepare", "status", "approve", "execute"];
  for (const action of paths) assert.ok(MCP_TOOLS.some((tool) => tool.name === `apn_swap_ethereum_uniswap_token_${action}`));
  assert.equal(MCP_TOOLS.length, 91);
  const quote = bindArgv(["swap", "ethereum", "uniswap-token", "quote", "--profile", "owner", "--account", ACCOUNT,
    "--to", ACCOUNT, "--source-token", UNISWAP_USDC, "--output-token", ETHEREUM_USDT, "--amount", "1000000",
    "--minimum-output", "999000", "--approval-cap", "1000000", "--deadline", "1800000000",
    "--max-approval-gas-limit", "80000", "--max-swap-gas-limit", "200000", "--max-cleanup-gas-limit", "80000",
    "--max-fee-per-gas", "2000000000", "--max-priority-fee-per-gas", "100000000", "--max-native-debit", "720000000000000"]).request;
  assert.equal(quote.command, "swap.uniswap-token.quote");
  assert.equal(bindArgv(["swap", "ethereum", "uniswap", "inventory"]).request.command, "swap.uniswap.inventory");
});

test("MCP token approve and execute return exact foreground CLI handoffs", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const server = createMcpServer({ stateRoot: temporary.root }), pair = InMemoryTransport.createLinkedPair();
  await server.connect(pair[1]); const client = new Client({ name: "token-mcp", version: "1" }); await client.connect(pair[0]);
  t.after(async () => { await client.close(); await server.close(); });
  for (const action of ["approve", "execute"]) {
    const result = await client.callTool({ name: `apn_swap_ethereum_uniswap_token_${action}`, arguments: { operation: OPERATION } });
    const content = result.content[0]; if (content?.type !== "text") throw new Error("expected text");
    const envelope = JSON.parse(content.text) as OutputEnvelope;
    assert.equal(envelope.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal(envelope.error?.details?.cli_handoff, `apn swap ethereum uniswap-token ${action} --operation ${OPERATION}`);
  }
});
