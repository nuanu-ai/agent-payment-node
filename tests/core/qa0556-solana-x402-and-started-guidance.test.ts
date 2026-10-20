import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { ApnError } from "../../src/errors.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { EVM_REQUEST, EvmApproval, EvmTestRpc, EvmWrappingSecret, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

// QA 0.5.56 SOLANA-CAPABILITIES-X402-FALSE-056-001: capabilities named the working Solana x402 lane unavailable.
test("CLI and MCP Solana capabilities name the local x402 exact SPL lane and nothing wider", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const tool = projectMcpTools().find((candidate) => candidate.name === "apn_wallet_capabilities_solana")!;
  assert.match(tool.description, /local Solana x402 exact \(SPL\)/u);
  assert.doesNotMatch(tool.description, /unavailable Solana x402/u);
  const cli = bindArgv(["wallet", "capabilities-solana"]), mcp = bindMcpInput(tool.command, {});
  assert.deepEqual(mcp, cli);
  const output = await createApnCore(cli, { stateRoot: temporary.root }).execute(cli.request);
  assert.equal(output.ok, true, output.error?.message);
  const data = output.data as { x402: Record<string, unknown>; profiles: { provider: string; x402?: boolean }[] };
  assert.deepEqual(data.x402, {
    available: true, scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", provider: "local", feePayer: "seller_facilitator",
    // QA 0.5.57: the owner's x402 row can name only an inventory mint, so the capability lists those (wSOL is not one).
    assets: [{ symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
      { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 }],
    assetSource: "allowlist_inventory_classic_spl", refused: ["native_sol", "token_2022_mint", "mint_outside_inventory"],
    requires: ["local_solana_wallet", "APN_SOLANA_RPC_URL", "allowlist_x402_row_x402-exact-svm", "wallet_policy_per_mint"],
    commands: ["x402 solana pay", "x402 solana observe", "x402 solana status"],
  });
  assert.deepEqual(data.profiles.map((profile) => [profile.provider, profile.x402 === true]),
    [["local", true], ["coinbase-awal", false], ["metamask-smart-account", false], ["metamask-agent-wallet", false]]);
});

// QA 0.5.56 DIRECT-NONTTY-RETRY-SIGNED-GUIDANCE-056-001: a refused native call before signing left `started`, and a
// repeated approve claimed a signature that never existed. The guard stays; only its words follow the state.
test("a repeated approve of a started transfer says the signature is unresolved, and resume still closes it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // The native approval refuses without a terminal and records that it returned before any private entry.
  const approval = new EvmApproval();
  approval.rejection = new ApnError("APN_NATIVE_REJECTED", "Direct-transfer approval is not attached to a terminal.", { nativeCode: "APN_TTY_UNAVAILABLE" });
  const rpc = new EvmTestRpc(), setup = evmCore(temporary.root, rpc, new EvmWrappingSecret(), approval);
  rpc.sender = (await ensureDirectWallet(setup)).address;
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), { code: "APN_NATIVE_REJECTED" });
  assert.equal((await setup.core.transfer.status(prepared.operation_id) as { state: string }).state, "started");
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), (error: ApnError) => {
    assert.equal(error.code, "APN_OPERATION_BLOCKED");
    assert.match(error.message, /approval already started and its signature is unresolved; use operation resume/u);
    assert.doesNotMatch(error.message, /is already signed/u);
    return true;
  });
  const recovery = evmCore(temporary.root, rpc, setup.wrapping);
  await assert.rejects(recovery.core.transfer.resume(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal((await recovery.core.transfer.status(prepared.operation_id) as { state: string }).state, "failed_before_effect");
  assert.equal(rpc.submissions.length, 0); assert.equal(rpc.broadcastCount, 0);
  // A terminal operation answers approve with its own record and signs nothing.
  assert.equal((await recovery.core.transfer.approve(prepared.operation_id) as { state: string }).state, "failed_before_effect");
  assert.equal(rpc.broadcastCount, 0);
});
