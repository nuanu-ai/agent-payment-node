import assert from "node:assert/strict";
import test from "node:test";
import * as codecRuntime from "../../src/x402-codec.js";
import * as coreRuntime from "../../src/core.js";
import { domainHash } from "../../src/canonical.js";
import { normalizeX402HttpRequest } from "../../src/x402-http-request.js";
import { x402Network } from "../../src/x402-network.js";
import { validateX402Operation } from "../../src/x402-state-integrity.js";
import { initializeNetworkFixture, networkFixture, networkSettlement } from "./evm-x402-helpers.js";
import { temporaryState } from "./helpers.js";
import { testRuntime } from "./installed-runtime.js";
import { paidObservation } from "./x402-helpers.js";
import { X402_TRANSACTION, X402_URL } from "./x402-vectors.js";

const { decodeAndNormalizePaymentResponseHeader: decode } = await testRuntime(codecRuntime, "x402-codec.js");
const { ApnCore } = await testRuntime(coreRuntime, "core.js");
const PAYER = "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14";
const LIVE_TRANSACTION = "0x67bb11b02047ca446c92dd7dca804db8a40065dcb0c73ac3d01b234eb4a2fc73";
// Exact unsigned response from the paid AsterPay GET on 2026-09-07.
const LIVE_HEADER = "eyJ4NDAyVmVyc2lvbiI6Miwic3VjY2VzcyI6dHJ1ZSwidHhIYXNoIjoiMHg2N2JiMTFiMDIwNDdjYTQ0NmM5MmRkN2RjYTgwNGRiOGE0MDA2NWRjYjBjNzNhYzNkMDFiMjM0ZWI0YTJmYzczIiwicGF5ZXIiOiIweDBiNGRkMGMzZGEwMDFmYTE0NmVlZDNmODBiMDE4NjBiZWY2YjhhMTQiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMifQ==";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

test("exact live unsigned txHash response retains its original wire digest", () => {
  const result = decode(LIVE_HEADER, { payer: PAYER, amountAtomic: "5000", network: "eip155:8453" });
  assert.equal(result.classification, "success");
  assert.equal(result.transactionHash, LIVE_TRANSACTION);
  assert.equal(result.paymentResponseHeaderHash, "15c81f2053eaeec17d48d3a31b1bff2a53468d40fc28bbd4257a62eac47aa27d");
});

for (const chainId of [8453, 1, 42161] as const) {
  const network = x402Network(chainId).network;
  const expected = { payer: PAYER, amountAtomic: "5000", network };
  const fields = { success: true, network, payer: PAYER, amount: "5000" };

  test(`${network} canonical, alias and agreeing dual fields share one normalized settlement`, () => {
    const canonical = decode(encode({ ...fields, transaction: LIVE_TRANSACTION }), expected);
    for (const hashes of [{ txHash: LIVE_TRANSACTION }, { transaction: LIVE_TRANSACTION, txHash: LIVE_TRANSACTION }]) {
      const header = encode({ ...fields, ...hashes });
      const result = decode(header, expected);
      assert.equal(result.transactionHash, canonical.transactionHash);
      assert.equal(result.normalizedCanonicalJson, canonical.normalizedCanonicalJson);
      assert.equal(result.settlementResponseHash, canonical.settlementResponseHash);
      assert.equal(result.paymentResponseHeaderHash, domainHash("apn.x402.payment-response-header.v1", Buffer.from(header, "ascii")));
      assert.notEqual(result.paymentResponseHeaderHash, canonical.paymentResponseHeaderHash);
    }
  });

  test(`${network} rejects missing, malformed, zero and conflicting transaction identities`, () => {
    const invalid: unknown[] = [null, 7, "", "0x1234", `0x${"0".repeat(64)}`, `0x${"A".repeat(64)}`];
    const variants = [
      {}, { transaction: LIVE_TRANSACTION, txHash: `0x${"f".repeat(64)}` },
      ...invalid.flatMap((value) => [
        { txHash: value }, { transaction: value },
        { transaction: LIVE_TRANSACTION, txHash: value }, { transaction: value, txHash: LIVE_TRANSACTION },
      ]),
    ];
    for (const hashes of variants) {
      assert.throws(() => decode(encode({ ...fields, ...hashes }), expected), { code: "APN_X402_SETTLEMENT_INVALID" });
    }
  });

  test(`${network} alias cannot bypass frozen identity or strict JSON/base64 checks`, () => {
    const response = { ...fields, txHash: LIVE_TRANSACTION };
    for (const change of [
      { network: "eip155:10" }, { payer: `0x${"1".repeat(40)}` }, { payer: null },
      { amount: "5001" }, { amount: 5000 }, { success: "true" }, { errorReason: "settlement_pending" },
    ]) assert.throws(() => decode(encode({ ...response, ...change }), expected), { code: "APN_X402_SETTLEMENT_INVALID" });
    const duplicate = JSON.stringify(response).replace('"txHash":', `"txHash":"${LIVE_TRANSACTION}","txHash":`);
    for (const header of [Buffer.from(duplicate).toString("base64"), `${encode(response)}\n`]) {
      assert.throws(() => decode(header, expected), { code: "APN_X402_SETTLEMENT_INVALID" });
    }
    for (const errorReason of ["settlement_pending", "settlement_failed"]) {
      const result = decode(encode({ ...response, success: false, errorReason }), expected);
      assert.equal(result.classification, errorReason === "settlement_pending" ? "settlement_pending" : "failure_with_transaction");
    }
  });

  for (const method of ["GET", "POST"] as const) test(`${network} txHash paid ${method} persists body and receipt across core restart without another payment`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const fixture = networkFixture(temporary.root, chainId); await initializeNetworkFixture(fixture, chainId);
    const httpRequest = normalizeX402HttpRequest({ schemaVersion: "apn.http-request.v1", url: X402_URL, method,
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      bodyBase64: method === "POST" ? Buffer.from('{"query":"paid result"}\n').toString("base64") : "" });
    const prepared = await fixture.core.execute({ command: "x402.fetch.prepare", profile: "default", chainId,
      url: X402_URL, idempotencyKey: `alias-${chainId}-${method}`, httpRequest });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = (prepared.operation as { operationId: string }).operationId;
    const original = (await fixture.state.findX402Operation(operationId))!;
    assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
    const header = encode({ x402Version: 2, success: true, txHash: X402_TRANSACTION, network, payer: original.wallet });
    const bodyText = '{"paid":true,"result":"retained"}\n';
    const now = fixture.clock.now().toISOString();
    fixture.http.outcomes.push(paidObservation({ paymentResponseHeader: header, bodyText, startedAt: now, observedAt: now }));
    const sent = await fixture.core.execute({ command: "operation.resume", operationId });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const pending = (await fixture.state.findX402Operation(operationId))!;
    assert.equal(pending.state, "settlement_pending", "HTTP success alone must not finalize settlement");
    assert.equal(pending.settlementResponseObservation?.paymentResponseHeaderHash, domainHash("apn.x402.payment-response-header.v1", Buffer.from(header, "ascii")));
    const result = (await fixture.state.findX402Result(operationId))!;
    assert.equal(Buffer.from(result.bodyText, "base64").toString("utf8"), bodyText);
    assert.deepEqual(fixture.http.calls.map((call) => call.httpRequest), [httpRequest, httpRequest]);
    networkSettlement(fixture.rpc, original);
    const restarted = new ApnCore({ state: fixture.state, clock: fixture.clock, rpc: fixture.rpc, native: fixture.native, http: fixture.http, policy: fixture.policy });
    const completed = await restarted.execute({ command: "operation.resume", operationId });
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.equal((completed.operation as { state: string }).state, "completed");
    validateX402Operation((await fixture.state.findX402Operation(operationId))!);
    const receipt = await restarted.execute({ command: "receipt.get", operationId });
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    await restarted.execute({ command: "operation.resume", operationId });
    const replay = await restarted.execute({ command: "receipt.get", operationId });
    assert.equal(replay.ok, true);
    assert.deepEqual(replay.receipt, receipt.receipt);
    assert.deepEqual(await fixture.state.findX402Result(operationId), result);
    assert.equal(fixture.http.calls.length, 2);
    assert.equal(fixture.nativeCalls.filter((call) => call.operation === "x402Exact.approveAndAuthorize").length, 1);
  });
}
