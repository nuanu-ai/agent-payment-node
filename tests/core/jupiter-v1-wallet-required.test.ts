import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { bindArgv } from "../../src/command-binder.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { SolanaRpc, SolanaRpcBudget } from "../../src/solana/rpc.js";
import { StateStore } from "../../src/state.js";
import { createJupiterV1Runtime } from "../../src/swap/jupiter-solana/v1-runtime-factory.js";
import { temporaryState } from "./helpers.js";

// QA F08: a Jupiter quote for a profile without a Solana wallet refused APN_STATE_CORRUPT ("durable execution binding or
// signed message changed") with no next action. It is a missing wallet, and the command that creates it is the next action.

const payer = "GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki", PROFILE = "jupiter-no-wallet";
const ENSURE = `apn wallet ensure-solana --profile ${PROFILE} --provider local --accept-risk true`;
const quoteRequest = { command: "swap.jupiter.quote" as const, profile: PROFILE, account: payer, recipient: payer, amountAtomic: "1000000",
  slippageBps: 50, ownerSlippageCapBps: 50 };

function counters() {
  const count = { reads: 0, secrets: 0 };
  return { count, fetch: async () => { count.reads++; throw new Error("network forbidden"); },
    wrapping: { async load() { count.secrets++; throw new Error("custody forbidden"); }, async create() { count.secrets++; throw new Error("custody forbidden"); } } };
}

test("a Jupiter quote without a Solana wallet refuses as a missing wallet before any network read or custody", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const c = counters();
  const runtime = createJupiterV1Runtime({ state: new StateStore(temporary.root), clock: { now: () => new Date() },
    rpc: new SolanaRpc("https://example.com", c.fetch, new SolanaRpcBudget({ maxPhysicalRequests: 64 })), wrappingSecret: c.wrapping,
    foreground: false, providerFetch: c.fetch });
  await assert.rejects(runtime.quote(quoteRequest, new Date()), { code: "APN_WALLET_POLICY_REQUIRED",
    message: "Jupiter swaps from the profile's local Solana wallet, and this profile has no Solana wallet.",
    details: { reason: "jupiter_v1_local_wallet_required", nextActions: [ENSURE] } });
  assert.deepEqual(c.count, { reads: 0, secrets: 0 });
  // The next action is the real CLI command that creates the wallet.
  assert.deepEqual(bindArgv(ENSURE.split(" ").slice(1)).request, { command: "wallet.ensure-solana", profile: PROFILE, provider: "local", acceptRisk: true });
});

test("the CLI and MCP quote surfaces return the classified refusal with the ensure-solana next action", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const c = counters();
  const bound = bindArgv(["swap", "solana", "jupiter", "quote", "--profile", PROFILE, "--account", payer, "--to", payer, "--amount", "1000000",
    "--slippage-bps", "50", "--owner-slippage-cap-bps", "50"]);
  const cli = await createApnCore(bound, { stateRoot: temporary.root, solanaRpcFetch: c.fetch, wrappingSecret: c.wrapping }).execute(bound.request);
  const server = createMcpServer({ stateRoot: temporary.root, solanaRpcFetch: c.fetch, wrappingSecret: c.wrapping });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-jupiter-wallet-required", version: "1.0.0" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const content = (await client.callTool({ name: "apn_swap_solana_jupiter_quote", arguments: { profile: PROFILE, account: payer, to: payer,
    amount: "1000000", slippage_bps: "50", owner_slippage_cap_bps: "50" } })).content[0];
  assert.equal(content?.type, "text");
  const mcp = JSON.parse((content as { text: string }).text) as OutputEnvelope;
  for (const envelope of [cli, mcp]) {
    assert.equal(envelope.ok, false); assert.equal(envelope.error?.code, "APN_WALLET_POLICY_REQUIRED");
    assert.equal(envelope.error?.details?.reason, "jupiter_v1_local_wallet_required");
    assert.doesNotMatch(envelope.error?.message ?? "", /signed message|binding/u);
    assert.deepEqual(envelope.next_actions, [ENSURE]);
  }
  assert.deepEqual(c.count, { reads: 0, secrets: 0 });
});

test("a provider-linked Solana account is refused with its provider, and a local wallet reaches owner admission", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const c = counters();
  const accounts = new ChainAccountStore(temporary.root, { async load() { return Buffer.alloc(32, 77); }, async create() { return Buffer.alloc(32, 77); } });
  await accounts.ensureProvider({ profile: PROFILE, rail: "solana", provider: "coinbase-awal", address: payer });
  const runtime = () => createJupiterV1Runtime({ state: new StateStore(temporary.root), clock: { now: () => new Date() },
    rpc: new SolanaRpc("https://example.com", c.fetch, new SolanaRpcBudget({ maxPhysicalRequests: 64 })), wrappingSecret: c.wrapping,
    foreground: false, providerFetch: c.fetch });
  await assert.rejects(runtime().quote(quoteRequest, new Date()), { code: "APN_WALLET_POLICY_REQUIRED",
    details: { reason: "jupiter_v1_local_wallet_required", provider: "coinbase-awal", nextActions: [`apn wallet capabilities-solana --profile ${PROFILE}`] } });
  // A local wallet passes the owner read: the quote then stops at the missing policy, as before.
  const local = "jupiter-local-wallet";
  await accounts.ensureLocal({ profile: local, rail: "solana", create: async () => ({ address: payer, seed: Buffer.alloc(32, 9) }) });
  await assert.rejects(runtime().quote({ ...quoteRequest, profile: local }, new Date()), { code: "APN_OPERATION_BLOCKED",
    details: { reason: "jupiter_v1_owner_admission", nextActions: [`apn allowlist policy status --profile ${local}`] } });
  assert.deepEqual(c.count, { reads: 0, secrets: 0 });
});
