import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject, sha256 } from "../../src/canonical.js";
import { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { RelayObserveService } from "../../src/relay/observe.js";
import { bindArgv } from "../../src/command-binder.js";
import { runCli } from "../../src/cli.js";
import { RelayBnbReadOnlyRpc, RelayEthereumFinalityRpc } from "../../src/relay/observe-rpc.js";
import { RelayKeylessStatusService } from "../../src/relay/status.js";
import { ETHEREUM_DEPOSITORY, relayStatusLocator, validateRelayQuote } from "../../src/relay/quote.js";
import { RELAY_BNB_SOURCE, RELAY_POLYGON_RECIPIENT, validateRelayNativeQuote } from "../../src/relay/native-quote.js";
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
  const service = new RelayObserveService(state, source, () => ({ ...bnb }), status);
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
    canonicalBlockHash: hash("9") }) }, () => ({ ...f.bnb }),
  new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await reorg.observe(f.op.operationId)).state, "source_unproven");
  const noBnb = new RelayObserveService(f.state, f.source, () => ({ ...f.bnb, transaction: async () => null }),
    new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await noBnb.observe(f.op.operationId)).state, "provider_candidate_unproven");
  const wrong = new RelayObserveService(f.state, f.source, () => ({ ...f.bnb, transaction: async () => ({
    hash: bnbHash, chainId: 56, to: "0x1111111111111111111111111111111111111111", valueWei: 0n,
    blockNumber: 200n, blockHash: bnbBlock }) }),
    new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await wrong.observe(f.op.operationId)).state, "provider_candidate_unproven");
});

test("recipient credit without bound provider success is observed without operational acceptance", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const status = new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify({ ...f.payload,
    inTxHashes: [hash("9")] })));
  const result = await new RelayObserveService(f.state, f.source, () => ({ ...f.bnb }), status).observe(f.op.operationId);
  assert.equal(result.state, "recipient_credit_observed");
  assert.equal(result.providerStatusBound, false);
  assert.equal(result.operationalAcceptance, false);
});

test("multiple provider candidates remain ambiguous and make no BNB RPC calls", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const status = new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify({ ...f.payload,
    txHashes: [bnbHash, hash("9")] })));
  const result = await new RelayObserveService(f.state, f.source, () => ({ ...f.bnb }), status).observe(f.op.operationId);
  assert.equal(result.state, "provider_candidate_unproven");
  assert.equal(result.reason, "multiple_provider_candidates");
  assert.equal(f.counts().bnbReads, 0);
});

test("unfinalized source stops before provider status and BNB reads", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const service = new RelayObserveService(f.state, { finalizedDeposit: async () => null }, () => ({ ...f.bnb }),
    new RelayKeylessStatusService(f.state, async () => { throw new Error("status must not be queried"); }));
  assert.equal((await service.observe(f.op.operationId)).state, "source_unproven");
  assert.equal(f.counts().bnbReads, 0);
});

test("below-minimum candidate and unrelated credit cannot become paid proof", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const below = new RelayObserveService(f.state, f.source, () => ({ ...f.bnb, transaction: async () => ({
    hash: bnbHash, chainId: 56, to: recipient, valueWei: 1n, blockNumber: 200n, blockHash: bnbBlock }) }),
  new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await below.observe(f.op.operationId)).state, "provider_candidate_unproven");
  const unrelatedHash = hash("9");
  const unrelated = new RelayObserveService(f.state, f.source, () => ({
    ...f.bnb, transaction: async () => ({ hash: unrelatedHash, chainId: 56, to: recipient,
      valueWei: BigInt(f.op.minOutputAtomic), blockNumber: 200n, blockHash: bnbBlock }),
    receipt: async () => ({ transactionHash: unrelatedHash, status: "success", blockNumber: 200n, blockHash: bnbBlock }),
  }), new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify({ ...f.payload,
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
  const adapter = new RelayEthereumFinalityRpc("https://example.com", f.state, fake);
  assert.ok(await adapter.finalizedDeposit(sourceHash as `0x${string}`));
  assert.equal(calls, 3);
  let reorgCalls = 0;
  const reorg = { batchCall: async () => {
    reorgCalls++;
    return reorgCalls === 1 ? ["0x1", tx, receipt] : reorgCalls === 2 ? [included, finalized] :
      [{ ...included, hash: hash("8") }, finalized];
  } } as unknown as HttpsBaseRpc;
  assert.equal(await new RelayEthereumFinalityRpc("https://example.com", f.state, reorg).finalizedDeposit(sourceHash as `0x${string}`), null);
  assert.equal(reorgCalls, 3);
  let sequentialCalls = 0;
  const sequential = { batchCall: async () => {
    sequentialCalls++;
    const step = (sequentialCalls - 1) % 3;
    return step === 0 ? ["0x1", tx, receipt] : [included, finalized];
  } } as unknown as HttpsBaseRpc;
  const reusedSource = new RelayEthereumFinalityRpc("https://example.com", f.state, sequential);
  assert.ok(await reusedSource.finalizedDeposit(sourceHash as `0x${string}`));
  assert.ok(await reusedSource.finalizedDeposit(sourceHash as `0x${string}`));
  assert.equal(sequentialCalls, 6);
});

test("BNB RPC adapter caps physical POSTs at eight without retries", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  let calls = 0;
  const fake = { batchCall: async () => { calls++; return ["0x38"]; } } as unknown as HttpsBaseRpc;
  const adapter = new RelayBnbReadOnlyRpc("https://example.com", state, fake);
  for (let i = 0; i < 8; i++) assert.equal(await adapter.chainId(), 56);
  await assert.rejects(adapter.chainId(), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(adapter.physicalPosts, 8); assert.equal(calls, 8);
});

test("two sequential observations get separate six-POST BNB budgets", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const adapters: RelayBnbReadOnlyRpc[] = [];
  let physicalPosts = 0;
  const fake = { batchCall: async (requests: readonly { method: string; params: readonly unknown[] }[]) => {
    physicalPosts++;
    const request = requests[0]!;
    if (request.method === "eth_chainId") return ["0x38"];
    if (request.method === "eth_getTransactionByHash") return [{ hash: bnbHash, chainId: "0x38",
      to: recipient, value: `0x${BigInt(f.op.minOutputAtomic).toString(16)}`,
      blockNumber: "0xc8", blockHash: bnbBlock }];
    if (request.method === "eth_getTransactionReceipt") return [{ transactionHash: bnbHash,
      status: "0x1", blockNumber: "0xc8", blockHash: bnbBlock }];
    if (request.method === "eth_getBlockByNumber") return [{ number: request.params[0] === "safe" ? "0xcd" : request.params[0],
      hash: request.params[0] === "0xc8" ? bnbBlock : safeHash }];
    throw new Error("unexpected RPC method");
  } } as unknown as HttpsBaseRpc;
  const service = new RelayObserveService(f.state, f.source, () => {
    const adapter = new RelayBnbReadOnlyRpc("https://example.com", f.state, fake);
    adapters.push(adapter);
    return adapter;
  }, new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await service.observe(f.op.operationId)).state, "operational_acceptance");
  assert.equal((await service.observe(f.op.operationId)).state, "operational_acceptance");
  assert.deepEqual(adapters.map(adapter => adapter.physicalPosts), [6, 6]);
  assert.equal(physicalPosts, 12);
});

test("a reused BNB adapter is refused before a second observation spends its budget", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const service = new RelayObserveService(f.state, f.source, () => f.bnb,
    new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(f.payload))));
  assert.equal((await service.observe(f.op.operationId)).state, "operational_acceptance");
  const before = f.counts().bnbReads;
  await assert.rejects(service.observe(f.op.operationId), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(f.counts().bnbReads, before);
});

test("Relay observe CLI binds two explicit public RPCs and rejects extra capabilities", () => {
  const argv = ["relay", "observe", "--operation", "2".repeat(64),
    "--rpc-url", "https://ethereum-rpc.publicnode.com",
    "--bnb-rpc-url", "https://bsc-rpc.publicnode.com"];
  assert.deepEqual(bindArgv(argv), { request: { command: "relay.observe", operationId: "2".repeat(64) },
    rpcUrl: "https://ethereum-rpc.publicnode.com", bnbRpcUrl: "https://bsc-rpc.publicnode.com" });
  for (const invalid of [argv.slice(0, -2), [...argv, "--profile", "default"],
    [...argv, "--dry-run", "false"], [...argv, "--bnb-rpc-url", "https://bsc-rpc.publicnode.com"],
    [...argv.slice(0, -1), "https://user:pass@bsc-rpc.publicnode.com"]])
    assert.throws(() => bindArgv(invalid), { code: "APN_INVALID_INPUT" });
});

test("Relay observe CLI emits operational evidence with a bounded keyless adapter invocation", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const operationPath = join(f.temp.root, "relay-unsigned-operations", f.op.profileHash, `${f.op.operationId}.json`);
  const journalPath = join(f.temp.root, "relay-effect-journals", f.op.profileHash, `${f.op.operationId}.json`);
  const before = await Promise.all([readFile(operationPath), readFile(journalPath)]);
  const methods: string[] = [];
  const sourceStarts: number[] = [], bnbStarts: number[] = [];
  let providerReads = 0;
  const sourceRpc = { batchCall: async (calls: readonly { method: string; params: readonly unknown[] }[]) => {
    sourceStarts.push(Date.now());
    methods.push(...calls.map(call => `eth:${call.method}`));
    if (calls[0]?.method === "eth_chainId") return ["0x1", {
      ...f.sourceObservation.transaction, blockNumber: "0x64", blockHash: sourceBlock,
      chainId: "0x1", value: "0x0" }, {
      ...f.sourceObservation.receipt, blockNumber: "0x64", status: "0x1" }];
    return [{ number: "0x64", hash: sourceBlock }, { number: "0x65", hash: safeHash }];
  } } as unknown as HttpsBaseRpc;
  const bnbRpc = { batchCall: async (calls: readonly { method: string; params: readonly unknown[] }[]) => {
    bnbStarts.push(Date.now());
    const call = calls[0]!; methods.push(`bnb:${call.method}`);
    if (call.method === "eth_chainId") return ["0x38"];
    if (call.method === "eth_getTransactionByHash") return [{ hash: bnbHash, chainId: "0x38",
      to: recipient, value: `0x${BigInt(f.op.minOutputAtomic).toString(16)}`,
      blockNumber: "0xc8", blockHash: bnbBlock }];
    if (call.method === "eth_getTransactionReceipt") return [{ transactionHash: bnbHash,
      status: "0x1", blockNumber: "0xc8", blockHash: bnbBlock }];
    if (call.method === "eth_getBlockByNumber") return [{ number: call.params[0] === "safe" ? "0xcd" : call.params[0],
      hash: call.params[0] === "0xc8" ? bnbBlock : safeHash }];
    throw new Error("Unexpected RPC method");
  } } as unknown as HttpsBaseRpc;
  const result = await runCli(["relay", "observe", "--operation", f.op.operationId,
    "--rpc-url", "https://ethereum-rpc.publicnode.com", "--bnb-rpc-url", "https://bsc-rpc.publicnode.com"], {},
  { stateRoot: f.temp.root, relayObserveSourceRpc: sourceRpc, relayObserveBnbRpc: bnbRpc,
    relayStatusFetch: async () => { providerReads++; return new Response(JSON.stringify(f.payload)); } });
  assert.equal(result.ok, true);
  assert.equal(result.proof_class, "read_only_rpc_observation");
  const evidence = result.data as Awaited<ReturnType<RelayObserveService["observe"]>>;
  assert.equal(evidence.state, "operational_acceptance");
  assert.equal(evidence.operationalAcceptance, true);
  assert.equal(evidence.paidAcceptance, false);
  assert.equal(evidence.causalLinkCryptographicallyProven, false);
  assert.equal(evidence.destinationProof?.status, "recipient_credit_proven");
  assert.equal("requestId" in evidence, false);
  assert.ok(f.op.statusLocator);
  assert.equal(JSON.stringify(result).includes(f.op.statusLocator.requestId), false);
  assert.equal(methods.filter(method => method.startsWith("bnb:")).length, 6);
  assert.equal(methods.filter(method => method.startsWith("eth:eth_chainId")).length, 1);
  assert.equal(methods.length, 13);
  assert.equal(providerReads, 1);
  assert.equal(sourceStarts.length, 3);
  assert.ok(sourceStarts.slice(1).every((start, index) => start - sourceStarts[index]! >= 750), JSON.stringify(sourceStarts));
  assert.ok(bnbStarts.slice(1).every((start, index) => start - bnbStarts[index]! >= 750), JSON.stringify(bnbStarts));
  assert.deepEqual(await Promise.all([readFile(operationPath), readFile(journalPath)]), before);
});

test("separate state clients share persisted 750 ms pacing across Ethereum and BNB publicnode hosts", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const leftState = new StateStore(temp.root); await leftState.initialize();
  const rightState = new StateStore(temp.root);
  let now = 1_000_000;
  const starts: number[] = [];
  const wait = async (milliseconds: number) => { now += milliseconds; };
  const bnbRpc = { batchCall: async () => { starts.push(now); return ["0x38"]; } } as unknown as HttpsBaseRpc;
  const sourceRpc = { batchCall: async () => { starts.push(now); return ["0x1", null, null]; } } as unknown as HttpsBaseRpc;
  const bnb = new RelayBnbReadOnlyRpc("https://bsc-rpc.publicnode.com", leftState, bnbRpc,
    new EvmDirectRpcGuard(leftState, 8, () => now, wait));
  const ethereum = new RelayEthereumFinalityRpc("https://ethereum-rpc.publicnode.com", rightState, sourceRpc,
    () => new EvmDirectRpcGuard(rightState, 3, () => now, wait));
  assert.equal(await bnb.chainId(), 56);
  assert.equal(await ethereum.finalizedDeposit(sourceHash as `0x${string}`), null);
  assert.deepEqual(starts, [1_000_000, 1_000_750]);
  assert.equal(bnb.physicalPosts, 1);
});

test("contended cross-client provider lock refuses observe RPC before physical POST", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const holder = new StateStore(temp.root); await holder.initialize();
  const contender = new StateStore(temp.root, { lockWaitMs: 0 });
  const familyHash = sha256("rpc-provider-family\0publicnode.com");
  let entered!: () => void, release!: () => void;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const holding = holder.withLocks([`rpc-provider-family:${familyHash}`], async () => { entered(); await held; });
  await active;
  let posts = 0;
  const rpc = { batchCall: async () => { posts++; return ["0x38"]; } } as unknown as HttpsBaseRpc;
  const bnb = new RelayBnbReadOnlyRpc("https://bsc-rpc.publicnode.com", contender, rpc);
  try { await assert.rejects(bnb.chainId(), { code: "APN_STATE_BUSY" }); }
  finally { release(); await holding; }
  assert.equal(posts, 0);
  assert.equal(bnb.physicalPosts, 0);
});

test("Relay observe CLI keeps provider failure and source mismatch below operational acceptance", async t => {
  const f = await fixture(); t.after(f.temp.cleanup); await f.journal();
  const args = ["relay", "observe", "--operation", f.op.operationId,
    "--rpc-url", "https://ethereum-rpc.publicnode.com", "--bnb-rpc-url", "https://bsc-rpc.publicnode.com"];
  for (const payload of [{ ...f.payload, status: "failure" },
    { ...f.payload, inTxHashes: [hash("9")] }]) {
    const service = new RelayObserveService(f.state, f.source, () => ({ ...f.bnb }),
      new RelayKeylessStatusService(f.state, async () => new Response(JSON.stringify(payload))));
    const result = await runCli(args, {}, { stateRoot: f.temp.root, relayObserve: service });
    assert.equal(result.ok, true);
    const evidence = result.data as Awaited<ReturnType<RelayObserveService["observe"]>>;
    assert.equal(evidence.state, "recipient_credit_observed");
    assert.equal(evidence.operationalAcceptance, false);
    assert.equal(evidence.paidAcceptance, false);
    assert.equal(evidence.causalLinkCryptographicallyProven, false);
  }
});

test("Relay observe CLI rejects saved BNB native to Polygon operations before external reads", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const raw = JSON.parse(await readFile("tests/core/relay-fixtures/bnb-native-polygon-native-quote-20260925.json", "utf8"));
  const nativeQuote = await validateRelayNativeQuote(raw, { payer: RELAY_BNB_SOURCE,
    recipient: RELAY_POLYGON_RECIPIENT, amountAtomic: "1500000000000000",
    minimumOutputWei: "9000000000000000000", nowSeconds: 1790909529 });
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1",
    kind: "relay_unsigned", state: "prepared", terminal: false,
    profileHash: "1".repeat(64), operationId: "9".repeat(64), idempotencyHash: "3".repeat(64),
    requestHash: "4".repeat(64), sourceChainId: 56, destinationChainId: 137,
    sourceAccount: RELAY_BNB_SOURCE.toLowerCase(), recipient: RELAY_POLYGON_RECIPIENT.toLowerCase(),
    quoteDigest: nativeQuote.quoteDigest, nativeQuote, statusLocator: nativeQuote.statusLocator,
    policyDigest: "5".repeat(64), policyRevision: 1,
    depositNetworkFeeCeilingWei: nativeQuote.deposit.maximumNetworkFeeWei,
    amountAtomic: "1500000000000000", minOutputAtomic: nativeQuote.minimumOutputWei,
    createdAt: new Date(1790909529 * 1000).toISOString(),
    deadline: new Date(nativeQuote.deadline * 1000).toISOString() });
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  let reads = 0;
  const fake = { batchCall: async () => { reads++; return []; } } as unknown as HttpsBaseRpc;
  const result = await runCli(["relay", "observe", "--operation", op.operationId,
    "--rpc-url", "https://ethereum-rpc.publicnode.com", "--bnb-rpc-url", "https://bsc-rpc.publicnode.com"], {},
  { stateRoot: temp.root, relayObserveSourceRpc: fake, relayObserveBnbRpc: fake,
    relayStatusFetch: async () => { reads++; throw new Error("unexpected provider read"); } });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(result.error?.details?.reason, "saved_native_route_or_owner");
  assert.equal(reads, 0);
  assert.equal(JSON.stringify(result).includes(nativeQuote.statusLocator?.requestId ?? "unavailable"), false);
});
