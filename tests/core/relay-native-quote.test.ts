import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { relayNativeQuoteRequest, requestRelayNativeQuote, validateRelayNativeQuote,
  RELAY_BNB_SOURCE, RELAY_POLYGON_RECIPIENT } from "../../src/relay/native-quote.js";

const fixture = async (): Promise<any> => JSON.parse(await readFile("tests/core/relay-fixtures/bnb-native-polygon-native-quote-20260925.json", "utf8"));
const intent = { payer: RELAY_BNB_SOURCE, recipient: RELAY_POLYGON_RECIPIENT,
  amountAtomic: "1500000000000000", minimumOutputWei: "9000000000000000000", nowSeconds: 1790909529 };

test("BNB native to Polygon native POL request and captured quote bind one unsigned native deposit", async () => {
  assert.deepEqual(relayNativeQuoteRequest(intent), { user: RELAY_BNB_SOURCE, originChainId: 56,
    destinationChainId: 137, originCurrency: "0x0000000000000000000000000000000000000000",
    destinationCurrency: "0x0000000000000000000000000000000000000000", amount: intent.amountAtomic,
    tradeType: "EXACT_INPUT", recipient: RELAY_POLYGON_RECIPIENT, refundTo: RELAY_BNB_SOURCE,
    includeProtocolData: true, usePermit: false, useDepositAddress: false });
  const quote = await fixture(), validated = await validateRelayNativeQuote(quote, intent);
  assert.equal(validated.orderId, quote.protocol.v2.orderId);
  assert.equal(validated.minimumOutputWei, "9364983580530364650");
  assert.equal(validated.deposit.value, intent.amountAtomic);
  assert.equal(validated.deposit.chainId, 56);
  assert.equal(validated.deposit.maximumNetworkFeeWei, "10628658156250");
  assert.equal((validated.orderData as any).inputs[0].refunds[1].currency,
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359");
  assert.ok(Object.isFrozen(validated) && Object.isFrozen(validated.deposit));
  let calls = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), relayNativeQuoteRequest(intent));
    return { ok: true, json: fixture } as Response;
  }) as typeof fetch;
  assert.deepEqual(await requestRelayNativeQuote(intent, fetcher, () => intent.nowSeconds), validated);
  assert.equal(calls, 1);
});

test("BNB native route refuses other accounts, currencies, native value, calldata and order mutations", async () => {
  assert.throws(() => relayNativeQuoteRequest({ ...intent, payer: RELAY_POLYGON_RECIPIENT,
    recipient: RELAY_BNB_SOURCE }));
  assert.throws(() => relayNativeQuoteRequest({ ...intent, recipient: "0x1111111111111111111111111111111111111111" }));
  assert.throws(() => relayNativeQuoteRequest({ ...intent, amountAtomic: "1.5" }));
  const edits: Array<[string, (q: any) => void]> = [
    ["approval step", q => { q.steps.unshift(q.steps[0]); }],
    ["source chain", q => { q.steps[0].items[0].data.chainId = 1; }],
    ["token source", q => { q.details.currencyIn.currency.address = q.protocol.v2.orderData.inputs[0].refunds[1].currency; }],
    ["token destination", q => { q.details.currencyOut.currency.address = q.protocol.v2.orderData.inputs[0].refunds[1].currency; }],
    ["native value", q => { q.steps[0].items[0].data.value = "1"; }],
    ["deposit target", q => { q.steps[0].items[0].data.to = RELAY_BNB_SOURCE; }],
    ["deposit selector", q => { q.steps[0].items[0].data.data = "0xdeadbeef"; }],
    ["destination refund currency", q => { q.protocol.v2.orderData.inputs[0].refunds[1].currency = RELAY_BNB_SOURCE; }],
    ["output currency", q => { q.protocol.v2.orderData.output.payments[0].currency = RELAY_BNB_SOURCE; }],
    ["destination call", q => { q.protocol.v2.orderData.output.calls.push({}); }],
    ["wrong signer", q => { q.protocol.v2.orderSignature = `0x${"11".repeat(65)}`; }],
    ["fee overflow", q => { q.steps[0].items[0].data.maxFeePerGas = "100000000001"; }],
    ["conflicting status", q => { q.steps[0].requestId = `0x${"11".repeat(32)}`; }],
  ];
  for (const [name, edit] of edits) {
    const q = await fixture(); edit(q);
    await assert.rejects(validateRelayNativeQuote(q, intent), /Relay native quote rejected:/, name);
  }
});
