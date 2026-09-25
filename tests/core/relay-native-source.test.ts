import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { canonicalJson, domainHash, hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { bindArgv } from "../../src/command-binder.js";
import { runCli } from "../../src/cli.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayNativeSourceJournalRepository, dispatchRelayNativeDepositOnce,
  createRelayNativeSourceRuntime, publicRelayNativeSourceJournal, RelayNativeSourceRuntime } from "../../src/relay/native-source.js";
import { RelayRetireService } from "../../src/relay/retire.js";
import { RELAY_BNB_SOURCE, RELAY_POLYGON_RECIPIENT, validateRelayNativeQuote,
  verifySavedRelayNativeQuote } from "../../src/relay/native-quote.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const now = new Date(1790909529 * 1000);
const fixture = async () => JSON.parse(await readFile("tests/core/relay-fixtures/bnb-native-polygon-native-quote-20260925.json", "utf8"));
async function prepared(state: StateStore) {
  const quote = await validateRelayNativeQuote(await fixture(), { payer: RELAY_BNB_SOURCE,
    recipient: RELAY_POLYGON_RECIPIENT, amountAtomic: "1500000000000000",
    minimumOutputWei: "9000000000000000000", nowSeconds: Math.floor(now.getTime() / 1000) });
  assert.ok(quote.statusLocator);
  return freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: state.profileHash("evm-live-buyer"),
    operationId: "2".repeat(64), idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64),
    sourceChainId: 56, destinationChainId: 137, sourceAccount: RELAY_BNB_SOURCE.toLowerCase(),
    recipient: RELAY_POLYGON_RECIPIENT.toLowerCase(), quoteDigest: quote.quoteDigest,
    nativeQuote: quote, statusLocator: quote.statusLocator, policyDigest: "5".repeat(64), policyRevision: 1,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: quote.principalAtomic,
    minOutputAtomic: quote.minimumOutputWei, createdAt: now.toISOString(),
    deadline: new Date(quote.deadline * 1000).toISOString() });
}

test("saved native quote keeps solver signature and exact deposit binding at execution", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await prepared(new StateStore(temp.root));
  await verifySavedRelayNativeQuote(op.nativeQuote!);
  await assert.rejects(verifySavedRelayNativeQuote({ ...op.nativeQuote!, orderSignature: `0x${"0".repeat(130)}` }),
    /Relay native quote rejected/u);
  await assert.rejects(verifySavedRelayNativeQuote({ ...op.nativeQuote!, deposit: { ...op.nativeQuote!.deposit,
    value: "1" } }), /Relay native quote rejected/u);
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

test("crash after signing marker with empty custody closes no-effect, releases cap and permits retirement", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "relay-native-crash.test.1", publishedAt: "2026-09-30T00:00:00.000Z",
    effectiveDate: "2026-09-30", effectiveAt: "2026-09-30T00:00:00.000Z", expiresAt: "2026-10-03T00:00:00.000Z",
    chains: [{ chain: "eip155:56", family: "evm", name: "BNB Smart Chain", assets: [{ kind: "native", identifier: null,
      symbol: "BNB", decimals: 18, rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "2000000000000000", dailyLimitAtomic: "3000000000000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: "bnb-native-polygon-native-v1" } } }] }] });
  const original = await prepared(state), { integrityHash: _, ...fields } = original;
  const op = freezeRelayUnsignedOperation({ ...fields, policyDigest: registry.policyDigest });
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  const walletFields = { schemaVersion: "apn.state.v1" as const, profile: "evm-live-buyer",
    profileHash: op.profileHash, address: RELAY_BNB_SOURCE as Hex, createdAt: now.toISOString(),
    bindingHash: hashObject({ profile: "evm-live-buyer", address: RELAY_BNB_SOURCE, createdAt: now.toISOString() }) };
  await state.writeNewWallet({ ...walletFields, integrityHash: hashObject(walletFields) });
  const identity = { account: RELAY_BNB_SOURCE, chain: "eip155:56", asset: { kind: "native" as const, identifier: null } };
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
  Object.assign(runtime, { wallets: { describe: async () => ({ identity: { address: RELAY_BNB_SOURCE },
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
    profile: "evm-live-buyer", operationId: op.operationId });
  assert.equal(retired.state, "retired");
});
