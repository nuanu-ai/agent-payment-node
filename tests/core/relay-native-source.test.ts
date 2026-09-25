import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { canonicalJson, domainHash, hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { bindArgv } from "../../src/command-binder.js";
import { runCli } from "../../src/cli.js";
import { OperationService } from "../../src/operation-service.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayNativeSourceJournalRepository, dispatchRelayNativeDepositOnce,
  createRelayNativeSourceRuntime, publicRelayNativeSourceJournal, RelayNativeSourceRuntime } from "../../src/relay/native-source.js";
import { RelayRetireService } from "../../src/relay/retire.js";
import { RELAY_BNB_MONAD_ROUTE_REFERENCE, RELAY_BNB_MONAD_DEFAULT_ROUTE_REFERENCE, RELAY_BNB_DEFAULT_SOURCE,
  RELAY_BNB_SOURCE, RELAY_POLYGON_RECIPIENT, validateRelayNativeQuote,
  verifySavedRelayNativeQuote } from "../../src/relay/native-quote.js";
import { StateStore } from "../../src/state.js";
import { RelayNativeObserveService } from "../../src/relay/native-observe.js";
import { RelayKeylessStatusService } from "../../src/relay/status.js";
import { RelayEthereumFinalityRpc } from "../../src/relay/observe-rpc.js";
import type { HttpsBaseRpc } from "../../src/rpc.js";
import { TtyRelayNativeExecuteConfirmation } from "../../src/tty-approval.js";
import { temporaryState } from "./helpers.js";

const now = new Date(1790909529 * 1000);
const fixture = async () => JSON.parse(await readFile("tests/core/relay-fixtures/bnb-native-polygon-native-quote-20260925.json", "utf8"));
const txHash = (digit: string) => `0x${digit.repeat(64)}`;
async function prepared(state: StateStore, monad = false) {
  const recipient = monad ? RELAY_BNB_SOURCE : RELAY_POLYGON_RECIPIENT;
  const raw = monad ? JSON.parse(await readFile("tests/core/relay-fixtures/bnb-native-monad-native-quote-20260925.json", "utf8")) : await fixture();
  const quote = await validateRelayNativeQuote(raw, { payer: RELAY_BNB_SOURCE,
    recipient, amountAtomic: "1500000000000000",
    minimumOutputWei: monad ? "40000000000000000000" : "9000000000000000000", nowSeconds: Math.floor(now.getTime() / 1000) });
  assert.ok(quote.statusLocator);
  return freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: state.profileHash("evm-live-buyer"),
    operationId: "2".repeat(64), idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64),
    sourceChainId: 56, destinationChainId: monad ? 143 : 137, sourceAccount: RELAY_BNB_SOURCE.toLowerCase(),
    recipient: recipient.toLowerCase(), quoteDigest: quote.quoteDigest,
    nativeQuote: quote, statusLocator: quote.statusLocator, policyDigest: "5".repeat(64), policyRevision: 1,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: quote.principalAtomic,
    minOutputAtomic: quote.minimumOutputWei, createdAt: now.toISOString(),
    deadline: new Date(quote.deadline * 1000).toISOString() });
}
async function preparedDefault(state: StateStore) {
  const raw = JSON.parse(await readFile("tests/core/relay-fixtures/bnb-native-monad-native-default-quote-20260925.json", "utf8"));
  const quote = await validateRelayNativeQuote(raw, { payer: RELAY_BNB_DEFAULT_SOURCE,
    recipient: RELAY_BNB_DEFAULT_SOURCE, amountAtomic: "1200000000000000",
    minimumOutputWei: "32000000000000000000", nowSeconds: Math.floor(now.getTime() / 1000) });
  assert.ok(quote.statusLocator);
  return freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: state.profileHash("default"),
    operationId: "6".repeat(64), idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64),
    sourceChainId: 56, destinationChainId: 143, sourceAccount: RELAY_BNB_DEFAULT_SOURCE.toLowerCase(),
    recipient: RELAY_BNB_DEFAULT_SOURCE.toLowerCase(), quoteDigest: quote.quoteDigest,
    nativeQuote: quote, statusLocator: quote.statusLocator, policyDigest: "5".repeat(64), policyRevision: 1,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: quote.principalAtomic,
    minOutputAtomic: quote.minimumOutputWei, createdAt: now.toISOString(),
    deadline: new Date(quote.deadline * 1000).toISOString() });
}

test("native observation reconciles one BNB source send and bounded Monad recipient credit", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root), op = await prepared(state, true);
  const walletFields = { schemaVersion: "apn.state.v1" as const, profile: "evm-live-buyer" as const,
    profileHash: op.profileHash, address: RELAY_BNB_SOURCE as Hex, createdAt: now.toISOString(),
    bindingHash: hashObject({ profile: "evm-live-buyer", address: RELAY_BNB_SOURCE, createdAt: now.toISOString() }) };
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "relay-native-observe.test.1", publishedAt: "2026-09-30T00:00:00.000Z",
    effectiveDate: "2026-09-30", effectiveAt: "2026-09-30T00:00:00.000Z",
    chains: [{ chain: "eip155:56", family: "evm", name: "BNB Smart Chain", assets: [{ kind: "native", identifier: null,
      symbol: "BNB", decimals: 18, rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "2000000000000000", dailyLimitAtomic: "3000000000000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: RELAY_BNB_MONAD_ROUTE_REFERENCE } } }] }] });
  // The journal and usage record are bound to the same saved policy and operation.
  const { integrityHash: _old, ...fields } = op;
  const saved = freezeRelayUnsignedOperation({ ...fields, policyDigest: registry.policyDigest });
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(saved);
  await state.writeNewWallet({ ...walletFields, integrityHash: hashObject(walletFields) });
  const identity = { account: RELAY_BNB_SOURCE, chain: "eip155:56", asset: { kind: "native" as const, identifier: null } };
  const ledger = new AssetUsageLedger(temp.root), reservationId = assetUsageReservationId(identity,
    `relay-native-execute:${saved.operationId}`);
  await ledger.reserve({ ...identity, registry, rail: "bridge", amountAtomic: saved.amountAtomic,
    idempotencyKey: `relay-native-execute:${saved.operationId}`, now });
  const journals = new RelayNativeSourceJournalRepository(temp.root);
  let journal = await journals.advance(saved, null, "pending", null, now);
  journal = await journals.advance(saved, journal.integrityHash, "signing_started", null, now);
  journal = await journals.advance(saved, journal.integrityHash, "sealed", txHash("a"), now);
  journal = await journals.advance(saved, journal.integrityHash, "submitting", null, now);
  const sourceBlock = txHash("b"), destinationBlock = txHash("d"), safeBlock = txHash("e"), destinationHash = txHash("c");
  const sourceObservation = { transaction: { hash: txHash("a"), from: saved.sourceAccount,
    to: saved.nativeQuote!.deposit.to, input: saved.nativeQuote!.deposit.data,
    value: BigInt(saved.amountAtomic), chainId: 56 },
    receipt: { transactionHash: txHash("a"), status: "success" as const, blockNumber: 100n, blockHash: sourceBlock },
    canonicalBlockHash: sourceBlock };
  let payload = { status: "success", originChainId: 56, destinationChainId: 143,
    inTxHashes: [txHash("a")], txHashes: [destinationHash] };
  let destinationReads = 0;
  const destination = () => ({ chainId: async () => { destinationReads++; return 143; },
    transaction: async () => { destinationReads++; return { hash: destinationHash, chainId: 143,
      to: saved.recipient, valueWei: BigInt(saved.minOutputAtomic), blockNumber: 200n, blockHash: destinationBlock }; },
    receipt: async () => { destinationReads++; return { transactionHash: destinationHash, status: "success" as const,
      blockNumber: 200n, blockHash: destinationBlock }; },
    block: async (number: bigint) => { destinationReads++; return { number, hash: number === 200n ? destinationBlock : safeBlock }; },
    finalityCheckpoint: async () => { destinationReads++; return { number: 205n, hash: safeBlock }; },
    nativeTrace: async () => null });
  let observation = sourceObservation;
  let sourceReady = false;
  const status = new RelayKeylessStatusService(state, async () => new Response(JSON.stringify(payload), { status: 200 }));
  assert.equal((await status.status(saved.operationId)).status, "success");
  const service = new RelayNativeObserveService(state, { finalizedDeposit: async () => sourceReady ? observation : null }, destination,
    status,
    { now: () => now });
  assert.equal((await service.observe(saved)).state, "source_unproven");
  assert.equal((await journals.load(saved))?.phase, "submitting");
  assert.equal((await ledger.load(identity, reservationId))?.state, "reserved");
  sourceReady = true;
  const accepted = await service.observe(saved);
  assert.equal(accepted.state, "operational_acceptance", JSON.stringify(accepted));
  assert.equal(accepted.paidAcceptance, false); assert.equal(accepted.causalLinkCryptographicallyProven, false);
  assert.equal((await journals.load(saved))?.phase, "confirmed");
  assert.equal((await ledger.load(identity, reservationId))?.state, "finalized");
  assert.equal(destinationReads, 6);
  assert.equal((await service.observe(saved)).state, "operational_acceptance");
  payload = { ...payload, inTxHashes: [txHash("f")], txHashes: [destinationHash] };
  assert.equal((await service.observe(saved)).state, "recipient_credit_observed");
  payload = { ...payload, txHashes: [destinationHash, txHash("9")] };
  const readsBeforeAmbiguous = destinationReads;
  assert.equal((await service.observe(saved)).state, "provider_candidate_unproven");
  assert.equal(destinationReads, readsBeforeAmbiguous);
  observation = { ...sourceObservation, transaction: { ...sourceObservation.transaction, from: RELAY_POLYGON_RECIPIENT } };
  assert.equal((await service.observe(saved)).state, "source_unproven");
});

test("BNB source reader requires fifteen stable confirmations in three read batches", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root), sourceHash = txHash("a"), includedHash = txHash("b");
  await state.initialize();
  let calls = 0, head = 114n;
  const batchCall = async () => {
    calls++;
    if (calls === 1 || calls === 3) return ["0x38", { hash: sourceHash, from: RELAY_BNB_SOURCE,
      to: "0x0000000000000000000000000000000000000001", input: "0x1234", value: "0x1",
      chainId: "0x38", blockNumber: "0x64", blockHash: includedHash },
      { transactionHash: sourceHash, status: "0x1", blockNumber: "0x64", blockHash: includedHash }];
    return [{ number: "0x64", hash: includedHash }, { number: `0x${head.toString(16)}`, hash: txHash("c") }];
  };
  const reader = new RelayEthereumFinalityRpc("https://example.com", state,
    { batchCall } as unknown as HttpsBaseRpc, undefined, 56);
  assert.equal(await reader.finalizedDeposit(sourceHash as Hex), null);
  assert.equal(calls, 2);
  head = 115n;
  assert.ok(await reader.finalizedDeposit(sourceHash as Hex));
  assert.equal(calls, 5);
});

test("saved native quote keeps solver signature and exact deposit binding at execution", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await prepared(new StateStore(temp.root));
  await verifySavedRelayNativeQuote(op.nativeQuote!);
  await assert.rejects(verifySavedRelayNativeQuote({ ...op.nativeQuote!, orderSignature: `0x${"0".repeat(130)}` }),
    /Relay native quote rejected/u);
  await assert.rejects(verifySavedRelayNativeQuote({ ...op.nativeQuote!, deposit: { ...op.nativeQuote!.deposit,
    value: "1" } }), /Relay native quote rejected/u);
});

test("saved Monad quote binds route, recipient, depository, value and calldata", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const quote = (await prepared(new StateStore(temp.root), true)).nativeQuote!;
  assert.equal(quote.routeReference, RELAY_BNB_MONAD_ROUTE_REFERENCE);
  await verifySavedRelayNativeQuote(quote);
  const changed = (edit: (q: any) => void) => {
    const q: any = structuredClone(quote); edit(q);
    const { quoteDigest: _, ...projection } = q;
    q.quoteDigest = hashObject(projection);
    return q;
  };
  for (const edit of [
    (q: any) => { q.routeReference = "bnb-native-polygon-native-v1"; },
    (q: any) => { q.orderData.output.chainId = "polygon"; },
    (q: any) => { q.orderData.output.payments[0].recipient = RELAY_POLYGON_RECIPIENT; },
    (q: any) => { q.paymentDetails.depository = RELAY_BNB_SOURCE; },
    (q: any) => { q.deposit.value = "1"; },
    (q: any) => { q.deposit.data = "0x12345678"; },
  ]) await assert.rejects(verifySavedRelayNativeQuote(changed(edit)), /Relay native quote rejected:/u);
});

test("Monad execute uses the shared source journal and refuses absent buyer custody before RPC", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root), op = await prepared(state, true);
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  let calls = 0;
  const runtime = createRelayNativeSourceRuntime(state,
    { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) },
    "https://bsc-rpc.publicnode.com", async () => { calls++; return true; }, { now: () => now },
    { batchCall: async () => { calls++; return []; }, submitRawTransaction: async () => { calls++; return "0x0"; } });
  await assert.rejects(runtime.execute(op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 0);
  assert.equal(await new RelayNativeSourceJournalRepository(temp.root).load(op), null);
});

for (const profile of ["evm-live-buyer", "default"] as const) test(`${profile} native execution refuses a foreign delegated grant before RPC`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root), op = profile === "default" ? await preparedDefault(state) : await prepared(state, true);
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  const walletFields = { schemaVersion: "apn.state.v1" as const, profile, profileHash: op.profileHash,
    address: op.sourceAccount as Hex, createdAt: now.toISOString(),
    bindingHash: hashObject({ profile, address: op.sourceAccount, createdAt: now.toISOString() }) };
  await state.writeNewWallet({ ...walletFields, integrityHash: hashObject(walletFields) });
  let calls = 0;
  const runtime = new RelayNativeSourceRuntime(state,
    { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) },
    { confirm: async () => { calls++; return true; }, rpc: {
      batchCall: async () => { calls++; return []; }, submitRawTransaction: async () => { calls++; return "0x0"; },
    } }, { now: () => now });
  Object.assign(runtime, { permissions: { listAll: async () => [{ phase: "active",
    owner_address: op.sourceAccount, profile_hash: "f".repeat(64) }] } });
  await assert.rejects(runtime.execute(op.operationId), { code: "APN_OPERATION_BLOCKED",
    details: { reason: "foreign_encrypted_metamask_grant" } });
  assert.equal(calls, 0);
  assert.equal(await new RelayNativeSourceJournalRepository(temp.root).load(op), null);
});

test("Monad foreground consent names MON, the destination chain and exact deposit", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await prepared(new StateStore(temp.root), true);
  let screen = "";
  const terminal = { fd: 0, write: async (value: string) => { screen += value; },
    read: async function* () { yield Buffer.from("decline\n"); }, close: async () => {} };
  const consent = new TtyRelayNativeExecuteConfirmation({ openTerminal: async () => terminal,
    isTerminal: () => true });
  assert.equal(await consent.confirm({ operationId: op.operationId, sourceChainId: 56, destinationChainId: 143,
    sourceAccount: op.sourceAccount, recipient: op.recipient, amountAtomic: op.amountAtomic,
    minOutputAtomic: op.minOutputAtomic, deadline: op.deadline, quoteDigest: op.quoteDigest,
    requestId: op.statusLocator!.requestId, depositNetworkFeeCeilingWei: op.depositNetworkFeeCeilingWei!,
    depository: op.nativeQuote!.deposit.to, valueWei: op.nativeQuote!.deposit.value }), false);
  assert.ok(screen.includes("Monad (eip155:143)"));
  assert.ok(screen.includes("Minimum native MON output"));
  assert.ok(screen.includes(op.nativeQuote!.deposit.value));
  assert.ok(screen.includes(op.nativeQuote!.deposit.to));
  assert.ok(!screen.includes(op.statusLocator!.requestId));
});

test("native journal marks a single dispatch before send and never repeats an ambiguous send", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await prepared(new StateStore(temp.root));
  const store = new RelayNativeSourceJournalRepository(temp.root);
  let journal = await store.advance(op, null, "pending", null, now);
  journal = await store.advance(op, journal.integrityHash, "signing_started", null, now);
  const raw = "0x0102" as Hex, hash = keccak256(raw);
  journal = await store.advance(op, journal.integrityHash, "sealed", hash, now);
  let sends = 0;
  const send = async (_raw: Hex) => { sends++; throw new Error("lost send response"); };
  journal = await dispatchRelayNativeDepositOnce(op, journal, store, send, raw, now);
  assert.equal(journal.phase, "submitting"); assert.equal(sends, 1);
  assert.equal(journal.requestId, op.statusLocator!.requestId);
  assert.equal("requestId" in publicRelayNativeSourceJournal(journal), false);
  assert.equal(JSON.stringify(publicRelayNativeSourceJournal(journal)).includes(op.statusLocator!.requestId), false);
  const replay = await dispatchRelayNativeDepositOnce(op, journal, store, send, raw, now);
  assert.deepEqual(replay, journal); assert.equal(sends, 1);
  await assert.rejects(store.advance(op, journal.integrityHash, "submitting", null, now),
    { code: "APN_OPERATION_BLOCKED" });
});

test("default Monad profile is released only by a valid confirmed source journal", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root), op = await preparedDefault(state);
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  const operations = new OperationService(state), store = new RelayNativeSourceJournalRepository(temp.root);
  await assert.rejects(operations.assertProfileAvailable(op.profileHash), { code: "APN_OPERATION_BLOCKED" });
  let journal = await store.advance(op, null, "pending", null, now);
  await assert.rejects(operations.assertProfileAvailable(op.profileHash), { code: "APN_OPERATION_BLOCKED" });
  journal = await store.advance(op, journal.integrityHash, "signing_started", null, now);
  journal = await store.advance(op, journal.integrityHash, "sealed", `0x${"a".repeat(64)}`, now);
  journal = await store.advance(op, journal.integrityHash, "submitting", null, now);
  await assert.rejects(operations.assertProfileAvailable(op.profileHash), { code: "APN_OPERATION_BLOCKED" });
  journal = await store.advance(op, journal.integrityHash, "confirmed", null, now);
  await operations.assertProfileAvailable(op.profileHash);
  const status = await operations.status(op.operationId) as Awaited<ReturnType<OperationService["relayStatus"]>>;
  assert.equal(status.state, "source_confirmed"); assert.equal(status.terminal, true);
  assert.equal(status.sourceJournalIntegrityHash, journal.integrityHash);
  assert.equal(status.proofClass, "source_effect_confirmed");
  assert.equal("destinationProof" in status, false); assert.equal("paidAcceptance" in status, false);
  assert.equal("statusLocator" in status, false);
  const path = join(temp.root, "relay-native-source-journals", op.profileHash, `${op.operationId}.json`);
  await writeFile(path, `${JSON.stringify({ ...journal, quoteDigest: "f".repeat(64) })}\n`);
  await assert.rejects(operations.assertProfileAvailable(op.profileHash), { code: "APN_STATE_CORRUPT" });
});

test("native execute command remains distinct and keyless RPC URL is mandatory", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const op = await prepared(state);
  assert.deepEqual(bindArgv(["relay", "native", "execute", "--operation", op.operationId,
    "--rpc-url", "https://bsc-rpc.publicnode.com"]),
    { request: { command: "relay.native.execute", operationId: op.operationId }, rpcUrl: "https://bsc-rpc.publicnode.com" });
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  for (const url of ["http://rpc.example", "https://user:secret@rpc.example", "https://rpc.example/signed?key=x"])
    assert.throws(() => createRelayNativeSourceRuntime(state, wrapping, url, async () => true),
      { code: "APN_RPC_CONFIG" });
});

test("installed native execute CLI refuses absent buyer custody before any RPC or send", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root), op = await prepared(state);
  const repository = new RelayUnsignedOperationRepository(temp.root);
  await repository.persistLocked(op);
  let posts = 0;
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  const result = await runCli(["relay", "native", "execute", "--operation", op.operationId,
    "--rpc-url", "https://bsc-rpc.publicnode.com"], {}, { stateRoot: temp.root, wrappingSecret: wrapping,
    clock: { now: () => now }, relayExecuteTransport: {
      batchCall: async () => { posts++; return []; },
      submitRawTransaction: async () => { posts++; return "0x0"; },
    } });
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(posts, 0);
  assert.equal(await new RelayNativeSourceJournalRepository(temp.root).load(op), null);
});

for (const lane of ["polygon", "buyer-monad", "default-monad"] as const) test(`${lane} crash after signing marker with empty custody closes no-effect, releases cap and permits retirement`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const monad = lane !== "polygon", defaultRoute = lane === "default-monad";
  const profile = defaultRoute ? "default" : "evm-live-buyer";
  const owner = defaultRoute ? RELAY_BNB_DEFAULT_SOURCE : RELAY_BNB_SOURCE;
  const routeReference = defaultRoute ? RELAY_BNB_MONAD_DEFAULT_ROUTE_REFERENCE :
    monad ? RELAY_BNB_MONAD_ROUTE_REFERENCE : "bnb-native-polygon-native-v1";
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "relay-native-crash.test.1", publishedAt: "2026-09-30T00:00:00.000Z",
    effectiveDate: "2026-09-30", effectiveAt: "2026-09-30T00:00:00.000Z", expiresAt: "2026-10-03T00:00:00.000Z",
    chains: [{ chain: "eip155:56", family: "evm", name: "BNB Smart Chain", assets: [{ kind: "native", identifier: null,
      symbol: "BNB", decimals: 18, rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "2000000000000000", dailyLimitAtomic: "3000000000000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: routeReference } } }] }] });
  const original = defaultRoute ? await preparedDefault(state) : await prepared(state, monad), { integrityHash: _, ...fields } = original;
  const op = freezeRelayUnsignedOperation({ ...fields, policyDigest: registry.policyDigest });
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  const walletFields = { schemaVersion: "apn.state.v1" as const, profile,
    profileHash: op.profileHash, address: owner as Hex, createdAt: now.toISOString(),
    bindingHash: hashObject({ profile, address: owner, createdAt: now.toISOString() }) };
  await state.writeNewWallet({ ...walletFields, integrityHash: hashObject(walletFields) });
  const identity = { account: owner, chain: "eip155:56", asset: { kind: "native" as const, identifier: null } };
  const ledger = new AssetUsageLedger(temp.root), reservationId = assetUsageReservationId(identity,
    `relay-native-execute:${op.operationId}`);
  await ledger.reserve({ ...identity, registry, rail: "bridge", amountAtomic: op.amountAtomic,
    idempotencyKey: `relay-native-execute:${op.operationId}`, now });
  const journalStore = new RelayNativeSourceJournalRepository(temp.root);
  let journal = await journalStore.advance(op, null, "pending", null, now);
  journal = await journalStore.advance(op, journal.integrityHash, "signing_started", null, now);
  let sends = 0;
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  const runtime = new RelayNativeSourceRuntime(state, wrapping, { confirm: async () => true,
    rpc: { batchCall: async () => { throw new Error("unexpected RPC read"); },
      submitRawTransaction: async () => { sends++; throw new Error("unexpected send"); } } }, { now: () => now });
  // A deterministic crash seam: the signing marker was durable, but no encrypted signed slot was saved.
  const key = domainHash("apn.relay-native-deposit-custody.v1", canonicalJson({ operationId: op.operationId }));
  const directEffects: Record<string, unknown> = { [key]: { unreadable: true } };
  Object.assign(runtime, { wallets: { describe: async () => ({ identity: { address: owner },
    secret: { directEffects } }), clear: () => {} } });
  await assert.rejects(runtime.execute(op.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal((await journalStore.load(op))?.phase, "signing_started");
  assert.equal((await ledger.load(identity, reservationId))?.state, "reserved");
  delete directEffects[key];
  journal = await runtime.execute(op.operationId);
  assert.equal(journal.phase, "failed_before_effect"); assert.equal(journal.transactionHash, null);
  assert.equal((await ledger.load(identity, reservationId))?.state, "failed_before_effect");
  assert.equal(sends, 0);
  assert.equal((await runtime.execute(op.operationId)).phase, "failed_before_effect");
  const retired = await new RelayRetireService(state, { now: () => now }, wrapping).retire({
    profile, operationId: op.operationId });
  assert.equal(retired.state, "retired");
});
