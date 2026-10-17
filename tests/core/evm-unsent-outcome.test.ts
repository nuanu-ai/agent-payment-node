import assert from "node:assert/strict";
import test from "node:test";
import { evmAmbiguousSendOutcome, evmUnsentOutcome } from "../../src/evm-unsent-outcome.js";

const account = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14", transactionHash = `0x${"ab".repeat(32)}`;
const reader = (count: string, own: unknown) => {
  const calls: string[] = [];
  return { calls, read: async (method: string, params: readonly unknown[]) => {
    calls.push(method);
    if (method === "eth_getTransactionCount") { assert.deepEqual(params, [account, "safe"]); return count; }
    assert.deepEqual(params, [transactionHash]); return own;
  } };
};

test("signed bytes never land when the safe nonce passed them and the node does not know their hash", async () => {
  const r = reader("0x8", null);
  assert.equal(await evmUnsentOutcome(r.read, { account, nonce: 7n, transactionHash }), "never_lands");
  assert.deepEqual(r.calls, ["eth_getTransactionCount", "eth_getTransactionByHash"]);
});

test("an unconsumed nonce keeps the bytes resumable without reading the hash", async () => {
  for (const count of ["0x7", "0x6"]) {
    const r = reader(count, null);
    assert.equal(await evmUnsentOutcome(r.read, { account, nonce: 7n, transactionHash }), "nonce_not_consumed");
    assert.deepEqual(r.calls, ["eth_getTransactionCount"]);
  }
});

test("a known own transaction goes to normal observation", async () => {
  assert.equal(await evmUnsentOutcome(reader("0x8", { hash: transactionHash }).read, { account, nonce: 7n, transactionHash }), "own_transaction_known");
});

test("malformed reads and identities fail closed", async () => {
  await assert.rejects(evmUnsentOutcome(reader("8", null).read, { account, nonce: 7n, transactionHash }), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects(evmUnsentOutcome(reader("0x8", null).read, { account: "0x1", nonce: 7n, transactionHash }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(evmUnsentOutcome(reader("0x8", null).read, { account, nonce: 7n, transactionHash: "0x12" }), { code: "APN_INVALID_INPUT" });
});

/** An ambiguous send: nonces first (safe, latest), then the hash (transaction, receipt). */
const ambiguousReader = (safe: string, latest: string, transaction: unknown, receipt: unknown) => {
  const calls: string[] = [];
  return { calls, read: async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getTransactionCount") { calls.push(`count:${String(params[1])}`); assert.equal(params[0], account); return params[1] === "safe" ? safe : latest; }
    calls.push(method); assert.deepEqual(params, [transactionHash]); return method === "eth_getTransactionByHash" ? transaction : receipt;
  } };
};

test("an ambiguous send whose hash is unknown and whose nonce is free at the tip may resend the identical bytes", async () => {
  for (const latest of ["0x7", "0x6"]) {
    const r = ambiguousReader("0x6", latest, null, null);
    assert.equal(await evmAmbiguousSendOutcome(r.read, { account, nonce: 7n, transactionHash }), "resend_identical");
    assert.deepEqual(r.calls, ["count:safe", "count:latest", "eth_getTransactionByHash", "eth_getTransactionReceipt"]);
  }
});

test("an ambiguous send never lands once the safe nonce passed it with no transaction or receipt; known bytes and a pending other nonce wait", async () => {
  assert.equal(await evmAmbiguousSendOutcome(ambiguousReader("0x8", "0x8", null, null).read, { account, nonce: 7n, transactionHash }), "never_lands");
  assert.equal(await evmAmbiguousSendOutcome(ambiguousReader("0x7", "0x8", null, null).read, { account, nonce: 7n, transactionHash }), "other_transaction_pending");
  for (const [transaction, receipt] of [[{ hash: transactionHash }, null], [null, { transactionHash }]] as const)
    for (const [safe, latest] of [["0x8", "0x8"], ["0x6", "0x7"]] as const)
      assert.equal(await evmAmbiguousSendOutcome(ambiguousReader(safe, latest, transaction, receipt).read, { account, nonce: 7n, transactionHash }), "own_transaction_known");
  await assert.rejects(evmAmbiguousSendOutcome(ambiguousReader("8", "0x8", null, null).read, { account, nonce: 7n, transactionHash }), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects(evmAmbiguousSendOutcome(ambiguousReader("0x8", "0x8", null, null).read, { account: "0x1", nonce: 7n, transactionHash }), { code: "APN_INVALID_INPUT" });
});
