import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ETHEREUM_DEPOSITORY, relayQuoteRequest, requestRelayQuote, validateRelayQuote } from "../../src/relay/quote.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const intent = { payer, recipient, amountAtomic: "2500000", minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 };
const fixture = async (): Promise<any> => JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));

test("finite request pins the exact route and requests locally verifiable protocol data", () => {
  assert.deepEqual(relayQuoteRequest(intent), { user: payer, originChainId: 1, destinationChainId: 56,
    originCurrency: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    destinationCurrency: "0x0000000000000000000000000000000000000000", amount: "2500000", tradeType: "EXACT_INPUT",
    recipient, refundTo: payer, includeProtocolData: true, usePermit: false, useDepositAddress: false });
  assert.throws(() => relayQuoteRequest({ ...intent, amountAtomic: "2.5" }));
});

test("captured executable quote validates offline and public transport makes one POST", async () => {
  const quote = await fixture();
  const validated = await validateRelayQuote(quote, intent);
  assert.equal(validated.minimumOutputWei, "3049241663777869");
  assert.equal(validated.deposit.to.toLowerCase(), ETHEREUM_DEPOSITORY);
  let calls = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    calls += 1;
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), relayQuoteRequest(intent));
    return { ok: true, json: async () => quote } as Response;
  }) as typeof fetch;
  assert.deepEqual(await requestRelayQuote(intent, fetcher, () => intent.nowSeconds), validated);
  assert.equal(calls, 1);
});

test("order, recipient, minimum, expiry, depository, approval and deposit mutations fail closed", async () => {
  const edits: Array<[string, (q: any) => void]> = [
    ["empty steps", q => { q.steps = []; }],
    ["signature action", q => { q.steps[0].kind = "signature"; }],
    ["deposit address", q => { q.steps[1].depositAddress = recipient; }],
    ["extra action", q => { q.steps.push(q.steps[1]); }],
    ["payer", q => { q.steps[1].items[0].data.from = recipient; }],
    ["chain", q => { q.steps[1].items[0].data.chainId = 56; }],
    ["input amount", q => { q.protocol.v2.orderData.inputs[0].payment.amount = "2500001"; }],
    ["input currency", q => { q.protocol.v2.orderData.inputs[0].payment.currency = recipient; }],
    ["output recipient", q => { q.protocol.v2.orderData.output.payments[0].recipient = payer; }],
    ["minimum", q => { q.protocol.v2.orderData.output.payments[0].minimumAmount = "1"; }],
    ["expired", q => { q.protocol.v2.orderData.output.deadline = intent.nowSeconds; }],
    ["refund", q => { q.protocol.v2.orderData.inputs[0].refunds[0].recipient = recipient; }],
    ["destination call", q => { q.protocol.v2.orderData.output.calls = [{}]; }],
    ["order id", q => { q.protocol.v2.orderId = `0x${"11".repeat(32)}`; }],
    ["order signature", q => { q.protocol.v2.orderSignature = `0x${"11".repeat(65)}`; }],
    ["quote depository", q => { q.protocol.v2.paymentDetails.depository = recipient; }],
    ["approval target", q => { q.steps[0].items[0].data.to = recipient; }],
    ["approval spender", q => { q.steps[0].items[0].data.data = q.steps[0].items[0].data.data.replace(ETHEREUM_DEPOSITORY.slice(2), recipient.slice(2)); }],
    ["deposit target", q => { q.steps[1].items[0].data.to = recipient; }],
    ["deposit order id", q => { q.steps[1].items[0].data.data = q.steps[1].items[0].data.data.slice(0, -64) + "11".repeat(32); }],
    ["deposit amount", q => { q.steps[1].items[0].data.data = q.steps[1].items[0].data.data.replace("00000000000000000000000000000000000000000000000000000000002625a0", "00000000000000000000000000000000000000000000000000000000002625a1"); }],
    ["native value", q => { q.steps[1].items[0].data.value = "1"; }],
    ["unbounded gas", q => { q.steps[1].items[0].data.gas = "500001"; }],
    ["unbounded fee", q => { q.steps[1].items[0].data.maxFeePerGas = "100000000001"; }],
    ["trailing calldata", q => { q.steps[1].items[0].data.data += "00"; }],
    ["extension", q => { q.steps[1].items[0].data.authorizationList = []; }],
  ];
  for (const [name, edit] of edits) {
    const quote = await fixture(); edit(quote);
    await assert.rejects(validateRelayQuote(quote, intent), /Relay quote rejected:/, name);
  }
});
