import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMetaMaskOuterTransaction } from "../../src/metamask-gasless/chain/transaction.js";
import { observeMetaMaskGasless } from "../../src/metamask-gasless/chain/observe.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";
import { canonicalJson } from "../../src/canonical.js";
import type { MetaMaskGaslessIntent, MetaMaskGaslessCursor, MetaMaskGaslessProviderObservation } from "../../src/metamask-gasless/model.js";
import type { Hex } from "../../src/model.js";
const fixture = JSON.parse(readFileSync("tests/core/metamask-gasless-chain-fixtures/arbitrum-rpc-signature-quantity-20261009.json", "utf8"));
const intent = fixture.intent as MetaMaskGaslessIntent;
const tx = fixture.replies.find((r: any) => r.method === "eth_getTransactionByHash").result;
const hash = tx.hash as Hex;
const error = { code: "APN_RPC_PROTOCOL", details: { reason: "mm_gasless_evidence_invalid" } };
const CURVE = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

test("untouched actual Arbitrum quantity signature traverses the complete production observer without network or effects", async () => {
  assert.equal(tx.r.length - 2, 63);
  const calls: string[] = [];
  const result = await observeMetaMaskGasless({ deployment: mmRegistry(42161), clock: { now: () => new Date(fixture.at) },
    call: async (method, params) => {
      calls.push(method);
      const reply = fixture.replies.find((r: any) => r.method === method && canonicalJson(r.params) === canonicalJson(params));
      assert.ok(reply, `uncached or effect-capable method ${method}`); return structuredClone(reply.result);
    } }, intent, fixture.cursor as MetaMaskGaslessCursor, fixture.provider as MetaMaskGaslessProviderObservation);
  assert.deepEqual(result, fixture.result);
  assert.equal(result.observation.phase, "pending");
  assert.equal(result.observation.candidateTxHash, hash);
  assert.equal(result.settlement, null); // Captured safe finality is before the included transaction.
  assert.ok(calls.includes("eth_call"));
  assert.ok(calls.every(m => ["eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getLogs"].includes(m)));
});

test("quantity and exact fixed-width DATA recover the identical actual hash, relayer and authorization owner", async () => {
  const exact = { ...tx, r: `0x${tx.r.slice(2).padStart(64, "0")}` };
  const [a,b] = await Promise.all([verifyMetaMaskOuterTransaction(tx, hash, intent), verifyMetaMaskOuterTransaction(exact, hash, intent)]);
  assert.deepEqual(a,b); assert.equal(a.from, tx.from); assert.equal(a.authorizationOwner, intent.binding.address);
});

test("outer and authorization scalars reject malformed encoding, noncanonical short padding and unsafe curve values", async () => {
  const malformed: unknown[] = [null, 1, "", "0x", "0X1", "-0x1", "1", "0xg", "0x01", "0x00", `0x${"1".repeat(65)}`, "0x0", `0x${"0".repeat(64)}`, `0x${CURVE.toString(16)}`];
  for (const field of ["r", "s"] as const) {
    for (const value of malformed) {
      await assert.rejects(verifyMetaMaskOuterTransaction({ ...tx, [field]: value }, hash, intent), error);
      const authorizationList = [{ ...tx.authorizationList[0], [field]: value }];
      await assert.rejects(verifyMetaMaskOuterTransaction({ ...tx, authorizationList }, hash, intent), error);
    }
  }
  const highS = `0x${(CURVE / 2n + 1n).toString(16)}`;
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...tx, s: highS }, hash, intent), error);
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...tx, authorizationList: [{ ...tx.authorizationList[0], s: highS }] }, hash, intent), error);
});

test("numeric normalization cannot bypass outer hash or authorization identity checks", async () => {
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...tx, r: "0x1" }, hash, intent), error);
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...tx, authorizationList: [{ ...tx.authorizationList[0], r: "0x1" }] }, hash, intent), error);
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...tx, yParity: "0x2" }, hash, intent), error);
});

test("legacy Base fixed32 DATA and its same-value shortened authorization scalar both authenticate", async () => {
  const base = JSON.parse(readFileSync("tests/core/metamask-gasless-chain-fixtures/base-signed-vector.json", "utf8"));
  const baseIntent = { ...intent, request: { ...intent.request, chainId: 8453 as const },
    binding: { ...intent.binding, address: base.owner } };
  const raw = base.type4.raw;
  assert.ok(raw.authorizationList[0].s.startsWith("0x0"));
  const quantity = { ...raw, authorizationList: [{ ...raw.authorizationList[0],
    s: `0x${BigInt(raw.authorizationList[0].s).toString(16)}` }] };
  const [a,b] = await Promise.all([verifyMetaMaskOuterTransaction(raw, base.type4.hash, baseIntent),
    verifyMetaMaskOuterTransaction(quantity, base.type4.hash, baseIntent)]);
  assert.deepEqual(a,b); assert.equal(a.authorizationOwner, base.owner);
});
