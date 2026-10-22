/**
 * QA 0.5.65 SOLANA-X402-PREPARED-ERROR-CONTEXT-065-001: after `x402 solana pay` saved its prepared payment, a simulation
 * refusal (or an RPC failure binding the lifetime) answered with no operation id or next actions, though the prepared
 * record holds the account claim. X402-GENERIC-ASSET-ERROR-CONTEXT-065-002: with MXNB or USD1 selected, the balance,
 * balance-limit and cap-relation errors named USDC. Both are answers only: signing, sending, holds and limits are unchanged.
 */
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import assert from "node:assert/strict";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { ApnError } from "../../src/errors.js";
import { X402SolanaRepository } from "../../src/x402-solana/repository.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { ASSET_CASES, ASSET_LIMITS, admitAsset, assetChallenge, assetFixture } from "./x402-any-asset-helpers.js";
import { PAY_ARGS, readySolanaFixture, solanaPolicyArgs } from "./x402-solana-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const solanaId = (root: string, key: string) =>
  domainHash("apn.x402-solana.operation-id.v1", canonicalJson({ profileHash: new X402SolanaRepository(root).profileHash("default"), key }));

function assertPreparedContext(answer: OutputEnvelope, id: string, reason: string): void {
  assert.equal(answer.ok, false, JSON.stringify(answer));
  const details = answer.error?.details as Record<string, unknown>;
  assert.equal(details.reason, reason, JSON.stringify(answer));
  assert.deepEqual([details.operation_id, details.state, details.signed, details.exposed], [id, "prepared", false, false]);
  assert.equal((answer.operation as { operation_id: string }).operation_id, id);
  assert.match(answer.next_actions[0]!, /^apn x402 solana pay --profile default .* --idempotency-key <the same key>$/u);
  assert.deepEqual(answer.next_actions.slice(1), [`apn x402 solana observe --operation ${id}`]);
}

for (const via of ["cli", "mcp"] as const) test(`a Solana simulation refusal after prepare names the prepared payment and its next actions (${via})`, async (context) => {
  const f = await readySolanaFixture(context, runCli); f.rpc.simulateError = { InstructionError: [2n, { Custom: 1n }] };
  const key = `qa0565-sim-${via}`, server = createMcpServer(f.options as never), [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b);
  const client = new Client({ name: "qa0565-solana-prepared", version: "1" }); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  const refused = via === "cli" ? await runCli([...PAY_ARGS, "--idempotency-key", key], {}, f.options)
    : (await client.callTool({ name: "apn_x402_solana_pay", arguments: { profile: "default", url: X402_URL, asset: SOLANA_USDC,
      max_amount: "20000", idempotency_key: key } })).structuredContent as unknown as OutputEnvelope;
  assertPreparedContext(refused, solanaId(f.root, key), "solana_simulation_instruction_error");
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 0);
  // The same key continues the same payment once the cause is gone; it pays once.
  f.rpc.simulateError = null;
  const resumed = await runCli([...PAY_ARGS, "--idempotency-key", key], {}, f.options);
  assert.equal((resumed.data as { operation_id: string }).operation_id, solanaId(f.root, key), JSON.stringify(resumed));
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
});

test("an RPC failure binding the lifetime after prepare keeps its classification and names the prepared payment", async (context) => {
  const f = await readySolanaFixture(context, runCli), batch = f.rpc.batch.bind(f.rpc);
  f.rpc.batch = async (reads) => {
    if (reads.some((read) => read.method === "getLatestBlockhash")) throw new ApnError("APN_RPC_PROTOCOL", "Synthetic Solana RPC outage.");
    return await batch(reads);
  };
  const answer = await runCli([...PAY_ARGS, "--idempotency-key", "qa0565-rpc-cli"], {}, f.options);
  assert.equal(answer.error?.code, "APN_RPC_PROTOCOL", JSON.stringify(answer));
  const id = solanaId(f.root, "qa0565-rpc-cli"), details = answer.error?.details as Record<string, unknown>;
  assert.deepEqual([details.operation_id, details.state, details.signed, details.exposed], [id, "prepared", false, false]);
  assert.deepEqual(answer.next_actions.slice(1), [`apn x402 solana observe --operation ${id}`]);
});

test("before exposure an error's own remedy leads; a changed owner policy points at observe, never at the same failing pay", async (context) => {
  const f = await readySolanaFixture(context, runCli); f.rpc.simulateError = { InstructionError: [2n, { Custom: 1n }] };
  assert.equal((await runCli([...PAY_ARGS, "--idempotency-key", "qa0565-remedy"], {}, f.options)).ok, false);
  const id = solanaId(f.root, "qa0565-remedy"), observe = `apn x402 solana observe --operation ${id}`;
  const { solanaRpcUrl: _url, x402SolanaRpc: _rpc, ...noRpc } = f.options;
  const unconfigured = await runCli([...PAY_ARGS, "--idempotency-key", "qa0565-remedy"], {}, noRpc as never);
  assert.equal(unconfigured.error?.code, "APN_RPC_CONFIG", JSON.stringify(unconfigured));
  assert.equal(unconfigured.error?.details?.operation_id, id); assert.match(unconfigured.next_actions[0]!, /RPC/u);
  f.rpc.simulateError = null;
  assert.equal((await runCli(solanaPolicyArgs("60000000", "40000"), {}, f.options)).ok, true);
  const drifted = await runCli([...PAY_ARGS, "--idempotency-key", "qa0565-remedy"], {}, f.options);
  assert.equal(drifted.error?.code, "APN_PROFILE_DRIFT", JSON.stringify(drifted));
  assert.deepEqual([drifted.error?.details?.operation_id, drifted.next_actions], [id, [observe]]);
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 0);
});

for (const spec of ASSET_CASES.filter((asset) => asset.label === "Base MXNB" || asset.label === "BNB World Liberty USD1")) {
  test(`${spec.label}: balance, balance-limit and cap errors name the selected token and chain, not USDC`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const fixture = assetFixture(temporary.root, spec); await admitAsset(fixture, spec);
    const chain = `eip155:${spec.chainId}`, prepare = async (key: string) => await fixture.core.execute({ command: "x402.fetch.prepare",
      profile: "default", chainId: spec.chainId, asset: spec.token, url: X402_URL, idempotencyKey: key });
    const named = (answer: OutputEnvelope, code: string) => {
      assert.equal(answer.error?.code, code, JSON.stringify(answer));
      assert.ok(answer.error!.message.includes(spec.token) && answer.error!.message.includes(chain), answer.error!.message);
      assert.doesNotMatch(answer.error!.message, /USDC/u);
      assert.deepEqual([answer.error?.details?.chain, answer.error?.details?.asset], [chain, spec.token]);
    };
    fixture.rpc.x402Evidence = { ...fixture.rpc.x402Evidence, usdcAtomic: "0" };
    named(await prepare("qa0565-empty-0001"), "APN_INSUFFICIENT_USDC");
    fixture.rpc.x402Evidence = { ...fixture.rpc.x402Evidence, usdcAtomic: "100000001" }; fixture.http.outcomes.push(assetChallenge(spec));
    const over = await prepare("qa0565-over-0001"); named(over, "APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402");
    assert.deepEqual([over.error?.details?.balance_atomic, over.error?.details?.max_balance_atomic], ["100000001", ASSET_LIMITS.maxBalanceUsdcAtomic]);
    named(await fixture.core.execute({ command: "wallet.policy.set", profile: "default", chainId: spec.chainId, asset: spec.token,
      maxBalanceUsdcAtomic: "100", maxX402AmountAtomic: "101" }), "APN_INVALID_INPUT");
  });
}
