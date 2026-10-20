import { address, getCompiledTransactionMessageDecoder, getPublicKeyFromAddress, getTransactionDecoder, verifySignature } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import assert from "node:assert/strict";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { decodePaymentSignatureHeader } from "../../src/x402-codec.js";
import { x402SolanaUsageIdentity, x402SolanaUsageKey } from "../../src/x402-solana/admission.js";
import { COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM, X402_SOLANA_NETWORK } from "../../src/x402-solana/constants.js";
import { X402SolanaRepository } from "../../src/x402-solana/repository.js";
import { testRuntime } from "./installed-runtime.js";
import { PAY_ARGS, feePayerAddress, readySolanaFixture } from "./x402-solana-helpers.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
type SolanaStatus = { readonly operation_id: string; readonly state: string; readonly pending_reason: string | null; readonly memo: string;
  readonly memo_source: string; readonly settlement: { readonly transaction: string; readonly source: string } | null;
  readonly seller_response: { readonly status: number; readonly settlement_hint: string | null; readonly result: { readonly body: string } | null } | null };
const data = (envelope: OutputEnvelope) => envelope.data as SolanaStatus;

const readySolana = async (context: test.TestContext) => await readySolanaFixture(context, runCli);
async function usageState(root: string, payer: string, operationId: string): Promise<string | null> {
  const identity = x402SolanaUsageIdentity({ payer, mint: SOLANA_USDC });
  return (await new AssetUsageLedger(root).load(identity, assetUsageReservationId(identity, x402SolanaUsageKey(operationId))))?.state ?? null;
}
const paidCount = (f: Awaited<ReturnType<typeof readySolanaFixture>>) => f.seller.calls.filter((call) => call.paymentSignature !== undefined).length;

test("unattended pay signs compute budget, one TransferChecked and the spec's nonce Memo with the facilitator as fee payer, once", async (context) => {
  const f = await readySolana(context);
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0001"], {}, f.options);
  assert.equal(paid.ok, true, JSON.stringify(paid));
  const status = data(paid);
  assert.equal(status.state, "exposed");
  assert.equal(status.seller_response?.status, 200);
  assert.equal(status.seller_response?.result?.body, '{"forecast":"sunny"}');
  assert.match(status.memo, /^[a-f0-9]{32}$/u); assert.equal(status.memo_source, "nonce");
  const sent = f.seller.calls.filter((call) => call.paymentSignature !== undefined);
  assert.equal(sent.length, 1);
  assert.equal((decodePaymentSignatureHeader(sent[0]!.paymentSignature!).accepted as { network: string }).network, X402_SOLANA_NETWORK);
  const record = (await new X402SolanaRepository(f.root).find(status.operation_id))!;
  const wire = getTransactionDecoder().decode(Buffer.from(record.signed!.rawPayload, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes) as unknown as { readonly staticAccounts: readonly string[];
    readonly instructions: readonly { readonly programAddressIndex: number; readonly accountIndices?: readonly number[]; readonly data?: Uint8Array }[] };
  const keys = message.staticAccounts.map(String), feePayer = await feePayerAddress();
  assert.equal(keys[0], feePayer); assert.equal(keys[1], f.payer);
  assert.deepEqual(message.instructions.map((instruction) => keys[instruction.programAddressIndex]),
    [COMPUTE_BUDGET_PROGRAM, COMPUTE_BUDGET_PROGRAM, TOKEN_PROGRAM_ADDRESS, MEMO_PROGRAM]);
  assert.equal(Buffer.from(message.instructions[3]!.data!).toString("utf8"), status.memo);
  assert.equal(message.instructions.some((instruction) => (instruction.accountIndices ?? []).includes(0)), false);
  const signatures = wire.signatures as Record<string, Uint8Array | null>;
  assert.equal(signatures[feePayer], null);
  assert.equal(await verifySignature(await getPublicKeyFromAddress(address(f.payer)), signatures[f.payer]! as never, wire.messageBytes), true);
  assert.equal(await usageState(f.root, f.payer, status.operation_id), "submitted");
  // A replay of the same key never sends again.
  assert.equal(data(await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0001"], {}, f.options)).state, "exposed");
  assert.equal(paidCount(f), 1);
  const observed = await runCli(["x402", "solana", "observe", "--operation", status.operation_id], {}, f.options);
  assert.equal(data(observed).state, "settled", JSON.stringify(observed));
  assert.equal(data(observed).settlement?.transaction, f.rpc.landed?.signature);
  assert.equal(data(observed).settlement?.source, "payment_response");
  assert.equal(await usageState(f.root, f.payer, status.operation_id), "finalized");
  const entry = await new OperationIndex(new SecureStateStore(f.root)).find(status.operation_id);
  assert.equal(entry?.state, "terminal"); assert.deepEqual(entry?.claims, []);
});

test("without a PAYMENT-RESPONSE the payment is found by its exact bytes in the payer token account's finalized signature index", async (context) => {
  const f = await readySolana(context); f.seller.mode = "settle_without_hint";
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0002"], {}, f.options);
  assert.equal(data(paid).seller_response?.settlement_hint, null);
  const observed = await runCli(["operation", "resume", "--operation", data(paid).operation_id], {}, f.options);
  assert.equal((observed.operation as SolanaStatus).state, "settled", JSON.stringify(observed));
  assert.equal((observed.operation as SolanaStatus).settlement?.source, "signature_index");
});

test("a refused payment ends as never landed only once the lifetime passed at finalized and the index covers the window", async (context) => {
  const f = await readySolana(context); f.seller.mode = "refuse";
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0003"], {}, f.options);
  const id = data(paid).operation_id;
  assert.equal(data(paid).seller_response?.status, 402);
  const open = await runCli(["x402", "solana", "observe", "--operation", id], {}, f.options);
  assert.equal(data(open).state, "exposed"); assert.equal(data(open).pending_reason, "lifetime_open");
  f.rpc.heights = { confirmed: 1_200n, finalized: 1_100n };
  const saved = f.rpc.index; f.rpc.index = [];
  assert.equal(data(await runCli(["x402", "solana", "observe", "--operation", id], {}, f.options)).pending_reason, "signature_index_not_covering");
  f.rpc.index = saved;
  const ended = await runCli(["x402", "solana", "observe", "--operation", id], {}, f.options);
  assert.equal(data(ended).state, "expired_unlanded", JSON.stringify(ended));
  assert.equal(await usageState(f.root, f.payer, id), "released_unsubmitted");
});

test("a payment that landed with an error is a finalized on-chain failure that moved no tokens", async (context) => {
  const f = await readySolana(context); f.seller.mode = "refuse";
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0004"], {}, f.options);
  await f.rpc.land(f.seller.received!, false);
  const observed = await runCli(["x402", "solana", "observe", "--operation", data(paid).operation_id], {}, f.options);
  assert.equal(data(observed).state, "failed_onchain", JSON.stringify(observed));
  assert.equal(await usageState(f.root, f.payer, data(paid).operation_id), "failed_confirmed_revert");
});

test("a simulation refusal signs nothing; the prepared payment ends without effect after its window", async (context) => {
  const f = await readySolana(context); f.rpc.simulateError = { InstructionError: [2n, { Custom: 1n }] };
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0005"], {}, f.options);
  assert.equal(paid.ok, false); assert.equal(paid.error?.details?.reason, "solana_simulation_instruction_error", JSON.stringify(paid));
  assert.equal(paidCount(f), 0);
  const id = domainHash("apn.x402-solana.operation-id.v1", canonicalJson({ profileHash: new X402SolanaRepository(f.root).profileHash("default"), key: "sol-pay-0005" }));
  assert.equal((await new X402SolanaRepository(f.root).find(id))?.state, "prepared");
  const later = { ...f.options, clock: { now: () => new Date(Date.now() + 300_000) } };
  const ended = await runCli(["x402", "solana", "observe", "--operation", id], {}, later);
  assert.equal(data(ended).state, "failed_before_effect", JSON.stringify(ended));
  assert.equal(await usageState(f.root, f.payer, id), null);
});

test("the owner abandons an exposed payment no proof decides; the price stays charged", async (context) => {
  const f = await readySolana(context); f.seller.mode = "refuse";
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", "sol-pay-0006"], {}, f.options);
  const approvals: string[] = [];
  const abandoned = await runCli(["operation", "abandon", "--operation", data(paid).operation_id], {},
    { ...f.options, operationAbandonApproval: { approve: async (intent) => { approvals.push(intent.assetLabel); } } });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned));
  assert.deepEqual(approvals, [`USDC (${SOLANA_USDC})`]);
  assert.equal(await usageState(f.root, f.payer, data(paid).operation_id), "finalized");
});
