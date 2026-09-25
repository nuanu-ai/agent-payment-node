import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { bindArgv } from "../../src/command-binder.js";
import { runCli } from "../../src/cli.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayNativeSourceJournalRepository, dispatchRelayNativeDepositOnce,
  createRelayNativeSourceRuntime, publicRelayNativeSourceJournal } from "../../src/relay/native-source.js";
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
