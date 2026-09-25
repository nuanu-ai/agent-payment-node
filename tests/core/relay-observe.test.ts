import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { RelayObserveService } from "../../src/relay/observe.js";
import { RelayBnbReadOnlyRpc, RelayEthereumFinalityRpc } from "../../src/relay/observe-rpc.js";
import { RelayKeylessStatusService } from "../../src/relay/status.js";
import { ETHEREUM_DEPOSITORY, relayStatusLocator, validateRelayQuote } from "../../src/relay/quote.js";
import type { RelayBnbProofPorts } from "../../src/relay/destination-proof.js";
import { StateStore } from "../../src/state.js";
import type { HttpsBaseRpc } from "../../src/rpc.js";
import { temporaryState } from "./helpers.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14".toLowerCase();
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7".toLowerCase();
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const sourceHash = hash("a"), sourceBlock = hash("b"), bnbHash = hash("c"), bnbBlock = hash("d"), safeHash = hash("e");
const now = "2026-09-30T00:01:00.000Z";

async function fixture() {
  const temp = await temporaryState();
  const raw = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const base = await validateRelayQuote(raw, { payer, recipient, amountAtomic: "2500000",
    minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  const { quoteDigest: _, statusLocator: _old, ...projection } = base;
  const statusLocator = relayStatusLocator(hash("f"));
  const fields = { ...projection, statusLocator };
  const quote = { ...fields, quoteDigest: hashObject(fields) };
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: "1".repeat(64), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 56,
    sourceAccount: payer, recipient, quoteDigest: quote.quoteDigest, quote, statusLocator,
    policyDigest: "5".repeat(64), policyRevision: 1,
    approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: "2500000",
    minOutputAtomic: quote.minimumOutputWei, createdAt: "2026-09-30T00:00:00.000Z",
    deadline: new Date(quote.deadline * 1000).toISOString() });
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  const state = new StateStore(temp.root);
  const sourceObservation = { transaction: { hash: sourceHash, from: payer, to: ETHEREUM_DEPOSITORY,
      input: quote.deposit.data, value: 0n, chainId: 1 },
    receipt: { transactionHash: sourceHash, status: "success" as const, blockNumber: 100n, blockHash: sourceBlock },
    canonicalBlockHash: sourceBlock };
  let sourceReads = 0, getCount = 0, bnbReads = 0;
  const source = { finalizedDeposit: async () => { sourceReads++; return sourceObservation; } };
  const bnb: RelayBnbProofPorts = { chainId: async () => { bnbReads++; return 56; },
    transaction: async () => { bnbReads++; return { hash: bnbHash, chainId: 56, to: recipient,
      valueWei: BigInt(op.minOutputAtomic), blockNumber: 200n, blockHash: bnbBlock }; },
    receipt: async () => { bnbReads++; return { transactionHash: bnbHash, status: "success", blockNumber: 200n,
      blockHash: bnbBlock }; }, block: async number => { bnbReads++; return { number, hash: number === 200n ? bnbBlock : safeHash }; },
    finalityCheckpoint: async () => { bnbReads++; return { number: 205n, hash: safeHash }; },
    nativeTrace: async () => { bnbReads++; return null; } };
  const payload = { status: "success", originChainId: 1, destinationChainId: 56,
    inTxHashes: [sourceHash], txHashes: [bnbHash] };
  const status = new RelayKeylessStatusService(state, async () => { getCount++;
    return new Response(JSON.stringify(payload), { status: 200 }); });
  const service = new RelayObserveService(state, source, bnb, status);
  async function journal(phase: "approval" | "deposit" = "deposit") {
    const repo = new RelayEffectJournalRepository(temp.root);
    await repo.create(op.profileHash, op.operationId, "2026-09-30T00:00:00.000Z");
    // Synthetic journal write uses the normal compare-and-swap transitions.
    const events = phase === "deposit" ? [
      { kind: "mark_submission", role: "approval", marker: "6".repeat(64), at: now },
      { kind: "record_transaction", role: "approval", transactionHash: hash("7") },
      { kind: "observe", role: "approval", outcome: "confirmed", at: now },
      { kind: "mark_submission", role: "deposit", marker: "8".repeat(64), at: now },
      { kind: "record_transaction", role: "deposit", transactionHash: sourceHash },
      { kind: "observe", role: "deposit", outcome: "confirmed", at: now },
    ] as const : [
      { kind: "mark_submission", role: "approval", marker: "6".repeat(64), at: now },
      { kind: "record_transaction", role: "approval", transactionHash: hash("7") },
      { kind: "observe", role: "approval", outcome: "confirmed", at: now },
    ] as const;
    let saved = await repo.load(op.profileHash, op.operationId); assert.ok(saved);
    for (const event of events) saved = await repo.transition(op.profileHash, op.operationId, saved.integrityHash, event);
    return saved;
  }
  return { temp, op, service, journal, source, bnb, payload, sourceObservation,
    counts: () => ({ sourceReads, getCount, bnbReads }), state };
}

test("prepared, approval and deposit pending make no external reads", async t => {
  const f = await fixture(); t.after(f.temp.cleanup);
  assert.equal((await f.service.observe(f.op.operationId)).state, "prepared_waiting");
  await f.journal("approval");
  assert.equal((await f.service.observe(f.op.operationId)).state, "deposit_pending");
  assert.deepEqual(f.counts(), { sourceReads: 0, getCount: 0, bnbReads: 0 });
});

test("operational acceptance requires all three layers while paid and causal remain false", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const operationPath = join(f.temp.root, "relay-unsigned-operations", f.op.profileHash, `${f.op.operationId}.json`);
  const journalPath = join(f.temp.root, "relay-effect-journals", f.op.profileHash, `${f.op.operationId}.json`);
  const before = await Promise.all([readFile(operationPath), readFile(journalPath)]);
  const result = await f.service.observe(f.op.operationId);
  assert.equal(result.state, "operational_acceptance");
  assert.equal(result.sourceFinalized, true); assert.equal(result.providerStatusBound, true);
  assert.equal(result.destinationProof?.status, "recipient_credit_proven");
  assert.equal(result.causalLinkCryptographicallyProven, false);
  assert.equal(result.paidAcceptance, false);
  assert.deepEqual(f.counts(), { sourceReads: 1, getCount: 1, bnbReads: 6 });
  assert.deepEqual(await Promise.all([readFile(operationPath), readFile(journalPath)]), before);
});

test("source reorg, provider-only success, wrong recipient and no trace stay unproven", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const reorg = new RelayObserveService(f.state, { finalizedDeposit: async () => ({ ...f.sourceObservation,
    canonicalBlockHash: hash("9") }) }, f.bnb,
  new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await reorg.observe(f.op.operationId)).state, "source_unproven");
  const noBnb = new RelayObserveService(f.state, f.source, { ...f.bnb, transaction: async () => null },
    new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await noBnb.observe(f.op.operationId)).state, "provider_candidate_unproven");
  const wrong = new RelayObserveService(f.state, f.source, { ...f.bnb, transaction: async () => ({
    hash: bnbHash, chainId: 56, to: "0x1111111111111111111111111111111111111111", valueWei: 0n,
    blockNumber: 200n, blockHash: bnbBlock }) },
    new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await wrong.observe(f.op.operationId)).state, "provider_candidate_unproven");
});

test("recipient credit without bound provider success is observed without operational acceptance", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const status = new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify({ ...f.payload,
    inTxHashes: [hash("9")] })));
  const result = await new RelayObserveService(f.state, f.source, f.bnb, status).observe(f.op.operationId);
  assert.equal(result.state, "recipient_credit_observed");
  assert.equal(result.providerStatusBound, false);
  assert.equal(result.operationalAcceptance, false);
});

test("multiple provider candidates remain ambiguous and make no BNB RPC calls", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const status = new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify({ ...f.payload,
    txHashes: [bnbHash, hash("9")] })));
  const result = await new RelayObserveService(f.state, f.source, f.bnb, status).observe(f.op.operationId);
  assert.equal(result.state, "provider_candidate_unproven");
  assert.equal(result.reason, "multiple_provider_candidates");
  assert.equal(f.counts().bnbReads, 0);
});

test("unfinalized source stops before provider status and BNB reads", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const service = new RelayObserveService(f.state, { finalizedDeposit: async () => null }, f.bnb,
    new RelayKeylessStatusService(f.state, async () => { throw new Error("status must not be queried"); }));
  assert.equal((await service.observe(f.op.operationId)).state, "source_unproven");
  assert.equal(f.counts().bnbReads, 0);
});

test("below-minimum candidate and unrelated credit cannot become paid proof", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const below = new RelayObserveService(f.state, f.source, { ...f.bnb, transaction: async () => ({
    hash: bnbHash, chainId: 56, to: recipient, valueWei: 1n, blockNumber: 200n, blockHash: bnbBlock }) },
  new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await below.observe(f.op.operationId)).state, "provider_candidate_unproven");
  const unrelatedHash = hash("9");
  const unrelated = new RelayObserveService(f.state, f.source, {
    ...f.bnb, transaction: async () => ({ hash: unrelatedHash, chainId: 56, to: recipient,
      valueWei: BigInt(f.op.minOutputAtomic), blockNumber: 200n, blockHash: bnbBlock }),
    receipt: async () => ({ transactionHash: unrelatedHash, status: "success", blockNumber: 200n, blockHash: bnbBlock }),
  }, new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify({ ...f.payload,
    txHashes: [unrelatedHash] }))));
  const result = await unrelated.observe(f.op.operationId);
  assert.equal(result.destinationProof?.status, "recipient_credit_proven");
  assert.equal(result.destinationProof?.relayOrderFulfillmentProven, false);
  assert.equal(result.paidAcceptance, false);
  assert.equal(result.causalLinkCryptographicallyProven, false);
});

test("RPC adapter rechecks finalized source in three physical POSTs and refuses reorg", async t => {
  const f = await fixture(); t.after(f.temp.cleanup);
  const tx = { ...f.sourceObservation.transaction, blockNumber: "0x64", blockHash: sourceBlock,
    chainId: "0x1", value: "0x0", input: f.sourceObservation.transaction.input };
  const receipt = { ...f.sourceObservation.receipt, blockNumber: "0x64", status: "0x1" };
  const included = { number: "0x64", hash: sourceBlock }, finalized = { number: "0x65", hash: hash("9") };
  let calls = 0;
  const fake = { batchCall: async (requests: readonly unknown[]) => {
    calls++;
    assert.ok(calls <= 3);
    assert.ok(Array.isArray(requests));
    return calls === 1 ? ["0x1", tx, receipt] : calls === 2 ? [included, finalized] : [included, finalized];
  } } as unknown as HttpsBaseRpc;
  const adapter = new RelayEthereumFinalityRpc("https://example.com", fake);
  assert.ok(await adapter.finalizedDeposit(sourceHash as `0x${string}`));
  assert.equal(calls, 3);
  let reorgCalls = 0;
  const reorg = { batchCall: async () => {
    reorgCalls++;
    return reorgCalls === 1 ? ["0x1", tx, receipt] : reorgCalls === 2 ? [included, finalized] :
      [{ ...included, hash: hash("8") }, finalized];
  } } as unknown as HttpsBaseRpc;
  assert.equal(await new RelayEthereumFinalityRpc("https://example.com", reorg).finalizedDeposit(sourceHash as `0x${string}`), null);
  assert.equal(reorgCalls, 3);
});

test("BNB RPC adapter caps physical POSTs at eight without retries", async () => {
  let calls = 0;
  const fake = { batchCall: async () => { calls++; return ["0x38"]; } } as unknown as HttpsBaseRpc;
  const adapter = new RelayBnbReadOnlyRpc("https://example.com", fake);
  for (let i = 0; i < 8; i++) assert.equal(await adapter.chainId(), 56);
  await assert.rejects(adapter.chainId(), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(adapter.physicalPosts, 8); assert.equal(calls, 8);
});
