import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { address, getCompiledTransactionMessageDecoder, getPublicKeyFromAddress, getTransactionDecoder, verifySignature } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import assert from "node:assert/strict";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { decodePaymentSignatureHeader } from "../../src/x402-codec.js";
import { x402SolanaUsageIdentity, x402SolanaUsageKey } from "../../src/x402-solana/admission.js";
import { COMPUTE_BUDGET_PROGRAM, X402_SOLANA_NETWORK } from "../../src/x402-solana/constants.js";
import { X402SolanaRepository } from "../../src/x402-solana/repository.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { PAY_ARGS, SOL_PAYEE, TOKEN_2022, admitSolanaX402, feePayerAddress, solanaOffer, solanaX402Fixture } from "./x402-solana-helpers.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
type Status = { readonly operation_id: string; readonly state: string; readonly pending_reason: string | null; readonly settlement: { readonly transaction: string; readonly source: string } | null;
  readonly seller_response: { readonly status: number; readonly settlement_hint: string | null; readonly result: { readonly body: string } | null } | null };
const data = (envelope: OutputEnvelope) => envelope.data as Status;

async function ready(context: test.TestContext) {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = await solanaX402Fixture(temporary.root);
  return { ...fixture, root: temporary.root };
}
async function usageState(root: string, payer: string, operationId: string): Promise<string | null> {
  const identity = x402SolanaUsageIdentity({ payer, mint: SOLANA_USDC });
  return (await new AssetUsageLedger(root).load(identity, assetUsageReservationId(identity, x402SolanaUsageKey(operationId))))?.state ?? null;
}

test("pay signs exactly compute budget and one TransferChecked with the facilitator as fee payer, sends once and settles at finalized", async (context) => {
  const f = await ready(context); await admitSolanaX402(f.root, f.payer);
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0001"], {}, f.options);
  assert.equal(paid.ok, true, JSON.stringify(paid));
  const status = data(paid);
  assert.equal(status.state, "exposed");
  assert.equal(status.seller_response?.status, 200);
  assert.equal(status.seller_response?.result?.body, '{"forecast":"sunny"}');
  const facilitator = await feePayerAddress();
  assert.ok(f.screens.some((screen) => screen.includes(`Fee payer (the seller's facilitator): ${facilitator}`)));
  // The wire the seller received: one v0 message, two signers, three instructions, the payer signed and the fee payer slot empty.
  const sent = f.seller.calls.filter((call) => call.paymentSignature !== undefined);
  assert.equal(sent.length, 1);
  const payload = decodePaymentSignatureHeader(sent[0]!.paymentSignature!);
  assert.equal((payload.accepted as { network: string }).network, X402_SOLANA_NETWORK);
  const record = (await new X402SolanaRepository(f.root).find(status.operation_id))!;
  const wire = getTransactionDecoder().decode(Buffer.from(record.signed!.rawPayload, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes) as unknown as { readonly staticAccounts: readonly string[];
    readonly instructions: readonly { readonly programAddressIndex: number; readonly accountIndices?: readonly number[] }[] };
  const keys = message.staticAccounts.map(String), feePayer = await feePayerAddress();
  assert.equal(keys[0], feePayer); assert.equal(keys[1], f.payer);
  assert.deepEqual(message.instructions.map((instruction) => keys[instruction.programAddressIndex]), [COMPUTE_BUDGET_PROGRAM, COMPUTE_BUDGET_PROGRAM, TOKEN_PROGRAM_ADDRESS]);
  assert.equal(message.instructions.some((instruction) => (instruction.accountIndices ?? []).includes(0)), false);
  const signatures = wire.signatures as Record<string, Uint8Array | null>;
  assert.equal(signatures[feePayer], null);
  assert.equal(await verifySignature(await getPublicKeyFromAddress(address(f.payer)), signatures[f.payer]! as never, wire.messageBytes), true);
  assert.equal(await usageState(f.root, f.payer, status.operation_id), "submitted");
  // A replay of the same key never sends again.
  const replay = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0001"], {}, f.options);
  assert.equal(data(replay).state, "exposed");
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
  const observed = await runCli(["x402", "solana", "observe", "--operation", status.operation_id], {}, f.options);
  assert.equal(data(observed).state, "settled", JSON.stringify(observed));
  assert.equal(data(observed).settlement?.transaction, f.rpc.landed?.signature);
  assert.equal(data(observed).settlement?.source, "payment_response");
  assert.equal(await usageState(f.root, f.payer, status.operation_id), "finalized");
  const entry = await new OperationIndex(new SecureStateStore(f.root)).find(status.operation_id);
  assert.equal(entry?.state, "terminal"); assert.deepEqual(entry?.claims, []);
});

test("without a PAYMENT-RESPONSE the payment is found by its exact bytes in the payer token account's finalized signature index", async (context) => {
  const f = await ready(context); await admitSolanaX402(f.root, f.payer); f.seller.mode = "settle_without_hint";
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0002"], {}, f.options);
  assert.equal(data(paid).seller_response?.settlement_hint, null);
  const observed = await runCli(["operation", "resume", "--operation", data(paid).operation_id], {}, f.options);
  assert.equal((observed.operation as Status).state, "settled", JSON.stringify(observed));
  assert.equal((observed.operation as Status).settlement?.source, "signature_index");
});

test("a refused payment ends as never landed only once the lifetime passed at finalized and the index covers the window", async (context) => {
  const f = await ready(context); await admitSolanaX402(f.root, f.payer); f.seller.mode = "refuse";
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0003"], {}, f.options);
  const id = data(paid).operation_id;
  assert.equal(data(paid).seller_response?.status, 402);
  const open = await runCli(["x402", "solana", "observe", "--operation", id], {}, f.options);
  assert.equal(data(open).state, "exposed"); assert.equal(data(open).pending_reason, "lifetime_open");
  f.rpc.heights = { confirmed: 1_200n, finalized: 1_100n };
  const saved = f.rpc.index; f.rpc.index = [];
  const uncovered = await runCli(["x402", "solana", "observe", "--operation", id], {}, f.options);
  assert.equal(data(uncovered).pending_reason, "signature_index_not_covering");
  f.rpc.index = saved;
  const ended = await runCli(["x402", "solana", "observe", "--operation", id], {}, f.options);
  assert.equal(data(ended).state, "expired_unlanded", JSON.stringify(ended));
  assert.equal(await usageState(f.root, f.payer, id), "released_unsubmitted");
});

test("a payment that landed with an error is a finalized on-chain failure that moved no tokens", async (context) => {
  const f = await ready(context); await admitSolanaX402(f.root, f.payer); f.seller.mode = "refuse";
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0004"], {}, f.options);
  await f.rpc.land(f.seller.received!, false);
  const observed = await runCli(["x402", "solana", "observe", "--operation", data(paid).operation_id], {}, f.options);
  assert.equal(data(observed).state, "failed_onchain", JSON.stringify(observed));
  assert.equal(await usageState(f.root, f.payer, data(paid).operation_id), "failed_confirmed_revert");
});

test("a refused foreground decision signs nothing; the prepared payment ends without effect after its window", async (context) => {
  const f = await ready(context); await admitSolanaX402(f.root, f.payer); f.refuseConsent();
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0005"], {}, f.options);
  assert.equal(paid.ok, false); assert.equal(paid.error?.details?.nativeCode, "APN_APPROVAL_REFUSED", JSON.stringify(paid));
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 0);
  const profileHash = new X402SolanaRepository(f.root).profileHash("default");
  const id = domainHash("apn.x402-solana.operation-id.v1", canonicalJson({ profileHash, key: "sol-pay-0005" }));
  assert.equal((await new X402SolanaRepository(f.root).find(id))?.state, "prepared");
  const later = { ...f.options, clock: { now: () => new Date(Date.now() + 300_000) } };
  const ended = await runCli(["x402", "solana", "observe", "--operation", id], {}, later);
  assert.equal(data(ended).state, "failed_before_effect", JSON.stringify(ended));
  assert.equal(await usageState(f.root, f.payer, id), null);
});

test("the owner abandons an exposed payment no proof decides; the price stays charged", async (context) => {
  const f = await ready(context); await admitSolanaX402(f.root, f.payer); f.seller.mode = "refuse";
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0006"], {}, f.options);
  const approvals: string[] = [];
  const abandoned = await runCli(["operation", "abandon", "--operation", data(paid).operation_id], {},
    { ...f.options, operationAbandonApproval: { approve: async (intent) => { approvals.push(intent.assetLabel); } } });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned));
  assert.deepEqual(approvals, [`USDC (${SOLANA_USDC})`]);
  assert.equal(await usageState(f.root, f.payer, data(paid).operation_id), "finalized");
});

test("refusals before anything is signed name their reason", async (context) => {
  const f = await ready(context);
  const saved = process.env.APN_SOLANA_RPC_URL; delete process.env.APN_SOLANA_RPC_URL;
  context.after(() => { if (saved !== undefined) process.env.APN_SOLANA_RPC_URL = saved; });
  const { solanaRpcUrl: _url, ...withoutRpc } = f.options;
  await admitSolanaX402(f.root, f.payer);
  const noRpc = await runCli([...PAY_ARGS, "--idempotency-key", "sol-ref-0001"], {}, withoutRpc);
  assert.equal(noRpc.error?.code, "APN_RPC_CONFIG"); assert.equal(noRpc.error?.details?.setting, "APN_SOLANA_RPC_URL");
  assert.equal(f.seller.calls.length, 0);
  const cases: readonly [() => void | Promise<void>, string][] = [
    [async () => { f.seller.offers = [solanaOffer(await feePayerAddress(), { extra: { feePayer: await feePayerAddress(), memo: "order-1" } })]; }, "x402_solana_memo_unsupported"],
    [async () => { f.seller.offers = [solanaOffer(await feePayerAddress(), { amount: "30000" })]; }, "x402_offer_exceeds_cap"],
    [async () => { f.seller.offers = [solanaOffer(f.payer)]; }, "x402_solana_fee_payer_invalid"],
    [async () => { f.seller.offers = [solanaOffer(await feePayerAddress())]; f.rpc.mintOwner = TOKEN_2022; }, "x402_solana_token_program_unsupported"],
    [() => { f.rpc.mintOwner = TOKEN_PROGRAM_ADDRESS; f.rpc.destinationExists = false; }, "x402_solana_payee_account_missing"],
  ];
  let key = 2;
  for (const [arrange, reason] of cases) {
    await arrange();
    const refused = await runCli([...PAY_ARGS, "--idempotency-key", `sol-ref-000${key++}`], {}, f.options);
    assert.equal(refused.ok, false); assert.equal(refused.error?.details?.reason, reason, JSON.stringify(refused));
  }
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 0);
});

test("owner admission per mint: another x402 pin, a payee outside the pin or a daily cap reached refuse before signing", async (context) => {
  const f = await ready(context);
  await admitSolanaX402(f.root, f.payer, { mechanism: { provider: "x402-exact-other", reference: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" } });
  const unpinned = await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0001"], {}, f.options);
  assert.equal(unpinned.error?.details?.reason, "allowlist_x402_not_admitted");
  await admitSolanaX402(f.root, f.payer, { recipients: [f.payer] });
  const pinned = await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0002"], {}, f.options);
  assert.equal(pinned.error?.details?.reason, "allowlist_recipient_not_admitted");
  await admitSolanaX402(f.root, f.payer, { maximumPerTransferAtomic: "15000", dailyLimitAtomic: "15000", recipients: [SOL_PAYEE] });
  const first = await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0003"], {}, f.options);
  assert.equal(first.ok, true, JSON.stringify(first));
  const held = await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0004"], {}, f.options);
  assert.equal(held.error?.code, "APN_OPERATION_BLOCKED", "the first payment still holds the Solana account");
  assert.equal(data(await runCli(["x402", "solana", "observe", "--operation", data(first).operation_id], {}, f.options)).state, "settled");
  const capped = await runCli([...PAY_ARGS, "--idempotency-key", "sol-adm-0005"], {}, f.options);
  assert.equal(capped.error?.details?.reason, "allowlist_daily_cap_exceeded", JSON.stringify(capped));
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
});

test("CLI and MCP read and observe the same Solana operation; MCP hands pay off to the foreground", async (context) => {
  const f = await ready(context); await admitSolanaX402(f.root, f.payer);
  const server = createMcpServer(f.options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-solana-parity", version: "1.0.0" }); await client.connect(clientTransport);
  context.after(async () => { await client.close(); await server.close(); });
  const invoke = async (name: string, input: Record<string, unknown>) => (await client.callTool({ name, arguments: input })).structuredContent as unknown as OutputEnvelope;
  const handoff = await invoke("apn_foreground_handoff", { command: "x402 solana pay", arguments: { profile: "default", url: PAY_ARGS[6], asset: SOLANA_USDC,
    max_amount: "20000", idempotency_key: "sol-mcp-0001" } });
  assert.equal(handoff.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.equal(f.seller.calls.length, 0);
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-mcp-0001"], {}, f.options);
  const id = data(paid).operation_id;
  const cliStatus = await runCli(["x402", "solana", "status", "--operation", id], {}, f.options);
  const mcpStatus = await invoke("apn_x402_solana_status", { operation: id });
  assert.deepEqual(mcpStatus.data, cliStatus.data);
  const mcpObserved = await invoke("apn_x402_solana_observe", { operation: id });
  assert.equal(data(mcpObserved).state, "settled", JSON.stringify(mcpObserved));
  assert.deepEqual((await runCli(["x402", "solana", "status", "--operation", id], {}, f.options)).data, mcpObserved.data);
});
