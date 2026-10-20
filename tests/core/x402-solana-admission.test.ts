import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import assert from "node:assert/strict";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { X402_SOLANA_POLICY_NETWORK } from "../../src/x402-network.js";
import { WRAPPED_SOL_MINT, X402_SOLANA_NETWORK } from "../../src/x402-solana/constants.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { PAY_ARGS, SOL_PAYEE, TOKEN_2022, admitSolanaX402, feePayerAddress, readySolanaFixture, solanaOffer, solanaPolicyArgs,
  solanaX402Fixture } from "./x402-solana-helpers.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
type Status = { readonly operation_id: string; readonly state: string; readonly memo: string; readonly memo_source: string };
const data = (envelope: OutputEnvelope) => envelope.data as Status;
const ready = async (context: test.TestContext, policy?: readonly string[]) => await readySolanaFixture(context, runCli, policy);
const paid = (f: { readonly seller: { readonly calls: readonly { readonly paymentSignature?: string }[] } }) =>
  f.seller.calls.filter((call) => call.paymentSignature !== undefined).length;

test("the x402 Solana network of the policy is the family's network", () => assert.equal(X402_SOLANA_POLICY_NETWORK, X402_SOLANA_NETWORK));

test("a seller memo is put into the Memo instruction verbatim and bound into the record", async (context) => {
  const f = await ready(context);
  f.seller.offers = [solanaOffer(await feePayerAddress(), { extra: { feePayer: await feePayerAddress(), memo: "saylor:video:frames",
    reference: "4HPo7gdcEk5PuEZvcUGufhX98TwW98oyCdHUagGkcoDK", session: "opaque-seller-session" } })];
  const result = await runCli([...PAY_ARGS, "--idempotency-key", "sol-memo-0001"], {}, f.options);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(data(result).memo, "saylor:video:frames"); assert.equal(data(result).memo_source, "seller");
  assert.equal(data(await runCli(["x402", "solana", "observe", "--operation", data(result).operation_id], {}, f.options)).state, "settled");
});

test("refusals before anything is signed name their reason", async (context) => {
  const f = await ready(context);
  const saved = process.env.APN_SOLANA_RPC_URL; delete process.env.APN_SOLANA_RPC_URL;
  context.after(() => { if (saved !== undefined) process.env.APN_SOLANA_RPC_URL = saved; });
  const { solanaRpcUrl: _url, ...withoutRpc } = f.options;
  const noRpc = await runCli([...PAY_ARGS, "--idempotency-key", "sol-ref-0001"], {}, withoutRpc);
  assert.equal(noRpc.error?.code, "APN_RPC_CONFIG"); assert.equal(noRpc.error?.details?.setting, "APN_SOLANA_RPC_URL");
  assert.equal(f.seller.calls.length, 0);
  const native = { scheme: "exact", network: X402_SOLANA_NETWORK, amount: "92964", asset: WRAPPED_SOL_MINT, payTo: SOL_PAYEE, maxTimeoutSeconds: 120,
    extra: { native: true, memo: "m", note: "Native SOL: send lamports with a system transfer, not an SPL transfer." } };
  const cases: readonly [() => void | Promise<void>, readonly string[], string][] = [
    [async () => { f.seller.offers = [solanaOffer(await feePayerAddress(), { amount: "60000" })]; }, PAY_ARGS, "x402_offer_exceeds_cap"],
    [async () => { f.seller.offers = [solanaOffer(f.payer)]; }, PAY_ARGS, "x402_solana_fee_payer_invalid"],
    [() => { f.seller.offers = [native]; }, [...PAY_ARGS.slice(0, 8), WRAPPED_SOL_MINT, ...PAY_ARGS.slice(9)], "x402_solana_native_sol_unsupported"],
    [async () => { f.seller.offers = [solanaOffer(await feePayerAddress())]; f.rpc.mintOwner = TOKEN_2022; }, PAY_ARGS, "x402_solana_token_program_unsupported"],
    [() => { f.rpc.mintOwner = TOKEN_PROGRAM_ADDRESS; f.rpc.destinationExists = false; }, PAY_ARGS, "x402_solana_payee_account_missing"],
  ];
  let key = 2;
  for (const [arrange, args, reason] of cases) {
    await arrange();
    const refused = await runCli([...args, "--idempotency-key", `sol-ref-000${key++}`], {}, f.options);
    assert.equal(refused.ok, false); assert.equal(refused.error?.details?.reason, reason, JSON.stringify(refused));
  }
  assert.equal(paid(f), 0);
});

test("unattended Solana x402 needs the owner's policy for the mint and stops an overfunded wallet", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const f = await solanaX402Fixture(temporary.root); await admitSolanaX402(temporary.root, f.payer);
  const missing = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pol-0001"], {}, f.options);
  assert.equal(missing.error?.code, "APN_WALLET_POLICY_REQUIRED");
  assert.deepEqual(missing.next_actions, [`apn wallet policy set --profile default --chain ${X402_SOLANA_NETWORK} --asset ${SOLANA_USDC} ` +
    "--max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>"]);
  assert.equal(paid(f), 0);
  assert.equal((await runCli(solanaPolicyArgs("40000000"), {}, f.options)).ok, true);
  assert.equal(f.policyApprovals.length, 1, "creating the policy needs the owner's foreground approval");
  const shown = await runCli(["wallet", "policy", "show", "--profile", "default", "--chain", X402_SOLANA_NETWORK, "--asset", SOLANA_USDC], {}, f.options);
  assert.equal((shown.data as { limits: { max_balance_usdc_atomic: string } }).limits.max_balance_usdc_atomic, "40000000");
  const overfunded = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pol-0002"], {}, f.options);
  assert.equal(overfunded.error?.code, "APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402", JSON.stringify(overfunded));
  const evm = await runCli([...solanaPolicyArgs(), "--x402-payees", SOL_PAYEE], {}, f.options);
  assert.equal(evm.error?.code, "APN_INVALID_INPUT");
  assert.equal(paid(f), 0);
});

test("owner admission per mint: another x402 pin, a payee outside the pin or a daily cap reached refuse before signing", async (context) => {
  const f = await ready(context);
  await admitSolanaX402(f.root, f.payer, { mechanism: { provider: "x402-exact-other", reference: TOKEN_PROGRAM_ADDRESS } });
  assert.equal((await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0001"], {}, f.options)).error?.details?.reason, "allowlist_x402_not_admitted");
  await admitSolanaX402(f.root, f.payer, { recipients: [f.payer] });
  assert.equal((await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0002"], {}, f.options)).error?.details?.reason, "allowlist_recipient_not_admitted");
  await admitSolanaX402(f.root, f.payer, { maximumPerTransferAtomic: "15000", dailyLimitAtomic: "15000", recipients: [SOL_PAYEE] });
  const first = await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0003"], {}, f.options);
  assert.equal(first.ok, true, JSON.stringify(first));
  const held = await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0004"], {}, f.options);
  assert.equal(held.error?.code, "APN_OPERATION_BLOCKED", "the first payment still holds the Solana account");
  assert.equal(data(await runCli(["x402", "solana", "observe", "--operation", data(first).operation_id], {}, f.options)).state, "settled");
  const capped = await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0005"], {}, f.options);
  assert.equal(capped.error?.details?.reason, "allowlist_daily_cap_exceeded", JSON.stringify(capped));
  assert.equal(paid(f), 1);
});

test("CLI and MCP pay, read and observe the same Solana operation unattended", async (context) => {
  const f = await ready(context);
  const server = createMcpServer(f.options as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-solana-parity", version: "1.0.0" }); await client.connect(clientTransport);
  context.after(async () => { await client.close(); await server.close(); });
  const invoke = async (name: string, input: Record<string, unknown>) => (await client.callTool({ name, arguments: input })).structuredContent as unknown as OutputEnvelope;
  const input = { profile: "default", url: PAY_ARGS[6]!, asset: SOLANA_USDC, max_amount: "20000", idempotency_key: "sol-mcp-0001" };
  const viaMcp = await invoke("apn_x402_solana_pay", input);
  assert.equal(viaMcp.ok, true, JSON.stringify(viaMcp));
  const replay = await runCli([...PAY_ARGS, "--idempotency-key", "sol-mcp-0001"], {}, f.options);
  assert.equal(data(replay).operation_id, data(viaMcp).operation_id);
  assert.equal(paid(f), 1);
  const id = data(viaMcp).operation_id;
  assert.deepEqual((await invoke("apn_x402_solana_status", { operation: id })).data, (await runCli(["x402", "solana", "status", "--operation", id], {}, f.options)).data);
  const observed = await invoke("apn_x402_solana_observe", { operation: id });
  assert.equal(data(observed).state, "settled", JSON.stringify(observed));
  assert.deepEqual((await runCli(["x402", "solana", "status", "--operation", id], {}, f.options)).data, observed.data);
  const policyShown = await invoke("apn_wallet_policy_show", { profile: "default", chain: X402_SOLANA_NETWORK, asset: SOLANA_USDC });
  assert.deepEqual(policyShown.data, (await runCli(["wallet", "policy", "show", "--profile", "default", "--chain", X402_SOLANA_NETWORK, "--asset", SOLANA_USDC], {}, f.options)).data);
});
