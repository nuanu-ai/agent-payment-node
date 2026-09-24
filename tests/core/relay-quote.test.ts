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
  assert.equal(validated.schemaVersion, "apn.relay-quote.v1");
  assert.match(validated.quoteDigest, /^[0-9a-f]{64}$/);
  assert.equal(validated.orderId, quote.protocol.v2.orderId);
  assert.equal(validated.orderSignature, quote.protocol.v2.orderSignature);
  assert.equal(validated.solver, quote.protocol.v2.orderData.solver);
  assert.equal(validated.payer, payer.toLowerCase());
  assert.equal(validated.recipient, recipient.toLowerCase());
  assert.equal(validated.sourceRefundRecipient, payer.toLowerCase());
  assert.equal(validated.principalAtomic, intent.amountAtomic);
  assert.equal(validated.orderData.salt, quote.protocol.v2.orderData.salt);
  assert.equal(validated.orderData.inputs[0]?.refunds[0]?.extraData, quote.protocol.v2.orderData.inputs[0].refunds[0].extraData);
  assert.equal(validated.paymentDetails.depository, ETHEREUM_DEPOSITORY);
  assert.equal(validated.minimumOutputWei, "3049241663777869");
  assert.equal(validated.deposit.to.toLowerCase(), ETHEREUM_DEPOSITORY);
  for (const [step, source] of [[validated.approval, quote.steps[0].items[0].data],
    [validated.deposit, quote.steps[1].items[0].data]] as const) {
    assert.equal(step.gas, source.gas);
    assert.equal(step.maxFeePerGas, source.maxFeePerGas);
    assert.equal(step.maxPriorityFeePerGas, source.maxPriorityFeePerGas);
    assert.equal(step.maximumNetworkFeeWei, (BigInt(source.gas) * BigInt(source.maxFeePerGas)).toString());
  }
  assert.ok(Object.isFrozen(validated) && Object.isFrozen(validated.orderData.inputs[0]?.refunds[0]));
  quote.steps[0].items[0].data.data = "0xdead";
  assert.notEqual(validated.approval.data, quote.steps[0].items[0].data.data);
  const expectedDigest = validated.quoteDigest;
  assert.equal((await validateRelayQuote(await fixture(), intent)).quoteDigest, expectedDigest);
  const higherFee = await fixture();
  higherFee.steps[0].items[0].data.maxFeePerGas = "292048424";
  const repriced = await validateRelayQuote(higherFee, intent);
  assert.notEqual(repriced.quoteDigest, expectedDigest);
  assert.equal(repriced.approval.maximumNetworkFeeWei, (73269n * 292048424n).toString());
  let calls = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    calls += 1;
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), relayQuoteRequest(intent));
    return { ok: true, json: fixture } as Response;
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
    ["missing gas", q => { delete q.steps[1].items[0].data.gas; }],
    ["missing max fee", q => { delete q.steps[1].items[0].data.maxFeePerGas; }],
    ["missing priority fee", q => { delete q.steps[1].items[0].data.maxPriorityFeePerGas; }],
    ["priority exceeds fee", q => { q.steps[1].items[0].data.maxPriorityFeePerGas = "292048424"; }],
    ["order extension", q => { q.protocol.v2.orderData.untrusted = "carry"; }],
    ["refund extension", q => { q.protocol.v2.orderData.inputs[0].refunds[0].untrusted = "carry"; }],
    ["malformed refund extra data", q => { q.protocol.v2.orderData.inputs[0].refunds[0].extraData = "0x01"; }],
    ["trailing calldata", q => { q.steps[1].items[0].data.data += "00"; }],
    ["extension", q => { q.steps[1].items[0].data.authorizationList = []; }],
  ];
  for (const [name, edit] of edits) {
    const quote = await fixture(); edit(quote);
    await assert.rejects(validateRelayQuote(quote, intent), /Relay quote rejected:/, name);
  }
});
