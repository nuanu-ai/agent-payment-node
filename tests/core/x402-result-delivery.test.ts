import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { HttpObservation } from "../../src/x402-model.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
import { TestClock, makeCore, temporaryState } from "./helpers.js";
import { ExactX402Native, QueuedHttp, RecoveryRpc, X402_TEST_ACCOUNT, challengeObservation, paidObservation } from "./x402-helpers.js";
import { X402_TRANSACTION, X402_URL, canonicalPaymentResponseHeader } from "./x402-vectors.js";

const SUCCESS = canonicalPaymentResponseHeader({
  success: true, transaction: X402_TRANSACTION, network: "eip155:8453", payer: X402_TEST_ACCOUNT.address.toLowerCase(), amount: "1250000",
});
const PENDING = canonicalPaymentResponseHeader({
  success: false, errorReason: "settlement_pending", transaction: X402_TRANSACTION, network: "eip155:8453",
});

async function send(t: TestContext, paid: HttpObservation) {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const http = new QueuedHttp([challengeObservation(), paid]);
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const core = makeCore({ root: temporary.root, native: new ExactX402Native(), rpc, http, clock: new TestClock() });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const prepared = await core.execute({ command: "x402.fetch.prepare", profile: "default", url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey: "delivery" });
  const operationId = (prepared.operation as { readonly operationId: string }).operationId;
  assert.equal((await core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  const sent = await core.execute({ command: "operation.resume", operationId });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const stored = await core.context.state.findX402Operation(operationId) as X402OperationRecord;
  return { sent, stored, core, operationId };
}

function binary(header: string, contentType: string, bytes: Uint8Array): HttpObservation {
  const base = paidObservation({ paymentResponseHeader: header });
  return { ...base, bodyBytes: bytes, rawHeaderPairs: [["Content-Type", contentType], ["Content-Length", String(bytes.byteLength)], ["PAYMENT-RESPONSE", header]] };
}

test("a body delivered with a pending settlement answer is stored and returned at once", async (t) => {
  const { sent, stored } = await send(t, paidObservation({ paymentResponseHeader: PENDING }));
  assert.equal(stored.state, "settlement_pending");
  assert.equal(stored.settlementResponseObservation?.classification, "settlement_pending");
  assert.notEqual(stored.resultLink, undefined);
  assert.deepEqual((sent.data as { readonly body?: unknown }).body, { forecast: "sunny" });
  assert.equal((sent.operation as { readonly terminal: boolean }).terminal, false, "settlement is still unproven");
});

test("a binary or non-UTF-8 paid body is kept as exact bytes with its payment response", async (t) => {
  for (const [label, contentType, bytes] of [
    ["png", "image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff])],
    ["latin1", "text/html; charset=iso-8859-1", Uint8Array.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e])],
    ["mixed-case-json", "Application/JSON", Buffer.from('{"a":1}')],
  ] as const) {
    await t.test(label, async (nested) => {
      const { sent, stored, core, operationId } = await send(nested, binary(SUCCESS, contentType, bytes));
      assert.equal(stored.state, "settlement_pending");
      assert.equal(stored.transactionHint?.transactionHash, X402_TRANSACTION);
      const data = sent.data as { readonly body_encoding?: string; readonly body?: string; readonly media_type?: string };
      assert.equal(data.body_encoding, "base64");
      assert.deepEqual(Buffer.from(data.body!, "base64"), Buffer.from(bytes));
      assert.equal(data.media_type, contentType.split(";")[0]!.toLowerCase());
      const status = await core.execute({ command: "operation.status", operationId });
      assert.equal(status.data, null, "status stays metadata-only");
    });
  }
});

test("a compressed or truncated body is withheld but never hides the payment response", async (t) => {
  const compressed = paidObservation({ paymentResponseHeader: SUCCESS });
  const gzip = { ...compressed, rawHeaderPairs: [...compressed.rawHeaderPairs, ["Content-Encoding", "gzip"] as const] };
  const truncated = { ...compressed, rawHeaderPairs: compressed.rawHeaderPairs.map(([name, value]) =>
    name === "Content-Length" ? [name, "999"] as const : [name, value] as const) };
  for (const [label, paid] of [["gzip", gzip], ["truncated", truncated]] as const) {
    await t.test(label, async (nested) => {
      const { sent, stored } = await send(nested, paid);
      assert.equal(stored.state, "settlement_pending");
      assert.equal(stored.attempts[0]?.phase, "observed");
      assert.equal(stored.transactionHint?.transactionHash, X402_TRANSACTION);
      assert.equal(stored.resultLink, undefined);
      assert.equal(sent.data, null);
    });
  }
});
