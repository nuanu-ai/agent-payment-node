import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "../../src/relay/quote.js";
import { RELAY_ARBITRUM_USDC, RELAY_ETHEREUM_USDC_RECIPIENT,
  relayArbitrumUsdcEthereumUsdcQuoteRequest, validateRelayArbitrumUsdcEthereumUsdcQuote,
} from "../../src/relay/arbitrum-usdc-ethereum-quote.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const intent = { payer, amountAtomic: "500000", minimumOutputAtomic: "94065", nowSeconds: 1790347296 };
const fixture = async (): Promise<any> => JSON.parse(await readFile(
  "tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json", "utf8"));

test("Arbitrum USDC to exact Ethereum recipient request is finite and unsigned", () => {
  assert.deepEqual(relayArbitrumUsdcEthereumUsdcQuoteRequest(intent), {
    user: payer.toLowerCase(), originChainId: 42161, destinationChainId: 1,
    originCurrency: RELAY_ARBITRUM_USDC, destinationCurrency: ETHEREUM_USDC,
    amount: "500000", tradeType: "EXACT_INPUT", recipient: RELAY_ETHEREUM_USDC_RECIPIENT,
    refundTo: payer.toLowerCase(), includeProtocolData: true, usePermit: false, useDepositAddress: false,
  });
  assert.throws(() => relayArbitrumUsdcEthereumUsdcQuoteRequest({ ...intent, amountAtomic: "0" }));
});

test("fresh captured approve and deposit quote materializes offline with exact bindings", async () => {
  const raw = await fixture();
  const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(raw, intent);
  assert.equal(quote.orderId, raw.protocol.v2.orderId);
  assert.equal(quote.orderSignature, raw.protocol.v2.orderSignature);
  assert.equal(quote.payer, payer.toLowerCase());
  assert.equal(quote.recipient, RELAY_ETHEREUM_USDC_RECIPIENT.toLowerCase());
  assert.equal(quote.minimumOutputAtomic, "94065");
  assert.equal(quote.paymentDetails.currency, RELAY_ARBITRUM_USDC.toLowerCase());
  assert.equal(quote.approval.to, RELAY_ARBITRUM_USDC.toLowerCase());
  assert.equal(quote.deposit.to, ETHEREUM_DEPOSITORY);
  assert.equal(quote.deposit.chainId, 42161);
  assert.equal(quote.approval.maxPriorityFeePerGas, "0");
  assert.equal(quote.deposit.maximumNetworkFeeWei, (85121n * 22000000n).toString());
  assert.equal(quote.providerFeeAtomic, "401482");
  assert.equal(quote.quotedDepositNetworkFeeWei, quote.deposit.maximumNetworkFeeWei);
  assert.match(quote.quoteDigest, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(quote) && Object.isFrozen(quote.orderData.inputs[0]?.refunds[0]));
  raw.steps[1].items[0].data.data = "0xdead";
  assert.notEqual(quote.deposit.data, raw.steps[1].items[0].data.data);
  assert.equal((await validateRelayArbitrumUsdcEthereumUsdcQuote(await fixture(), intent)).quoteDigest, quote.quoteDigest);
});

test("order, recipient, source token, bounds, signature, and unsigned transactions fail closed", async () => {
  const edits: Array<[string, (q: any) => void]> = [
    ["request ID", q => { q.steps[1].requestId = `0x${"11".repeat(32)}`; }],
    ["status endpoint", q => { q.steps[1].items[0].check.endpoint = "https://evil.example/path"; }],
    ["signature action", q => { q.steps[0].kind = "signature"; }],
    ["deposit address", q => { q.steps[1].depositAddress = payer; }],
    ["extra step", q => { q.steps.push(q.steps[1]); }],
    ["order version", q => { q.protocol.v2.orderData.version = "v2"; }],
    ["solver", q => { q.protocol.v2.orderData.solver = payer; }],
    ["input chain", q => { q.protocol.v2.orderData.inputs[0].payment.chainId = "ethereum"; }],
    ["input token", q => { q.protocol.v2.orderData.inputs[0].payment.currency = ETHEREUM_USDC; }],
    ["input amount", q => { q.protocol.v2.orderData.inputs[0].payment.amount = "500001"; }],
    ["output chain", q => { q.protocol.v2.orderData.output.chainId = "base"; }],
    ["output token", q => { q.protocol.v2.orderData.output.payments[0].currency = RELAY_ARBITRUM_USDC; }],
    ["output recipient", q => { q.protocol.v2.orderData.output.payments[0].recipient = payer; }],
    ["low output", q => { q.protocol.v2.orderData.output.payments[0].minimumAmount = "1"; }],
    ["extra call", q => { q.protocol.v2.orderData.output.calls = [{}]; }],
    ["router data", q => { q.protocol.v2.orderData.output.extraData = `0x${"00".repeat(32)}`; }],
    ["refund recipient", q => { q.protocol.v2.orderData.inputs[0].refunds[0].recipient = RELAY_ETHEREUM_USDC_RECIPIENT; }],
    ["refund token", q => { q.protocol.v2.orderData.inputs[0].refunds[1].currency = RELAY_ARBITRUM_USDC; }],
    ["expiry", q => { q.protocol.v2.orderData.output.deadline = intent.nowSeconds; }],
    ["order ID", q => { q.protocol.v2.orderId = `0x${"11".repeat(32)}`; }],
    ["signature", q => { q.protocol.v2.orderSignature = `0x${"11".repeat(65)}`; }],
    ["depository", q => { q.protocol.v2.paymentDetails.depository = payer; }],
    ["details chain", q => { q.details.currencyOut.currency.chainId = 8453; }],
    ["approval chain", q => { q.steps[0].items[0].data.chainId = 1; }],
    ["approval spender", q => { q.steps[0].items[0].data.data = q.steps[0].items[0].data.data.replace(ETHEREUM_DEPOSITORY.slice(2), payer.slice(2)); }],
    ["deposit order ID", q => { q.steps[1].items[0].data.data = q.steps[1].items[0].data.data.slice(0, -64) + "11".repeat(32); }],
    ["native value", q => { q.steps[1].items[0].data.value = "1"; }],
    ["fee token", q => { q.fees.relayer.currency.address = ETHEREUM_USDC; }],
    ["fee breakdown", q => { q.fees.relayerService.amount = "20042"; }],
    ["hidden app fee", q => { q.fees.app.amount = "1"; q.fees.app.minimumAmount = "1"; }],
    ["gas fee mismatch", q => { q.fees.gas.amount = "1"; q.fees.gas.minimumAmount = "1"; }],
    ["unbounded gas", q => { q.steps[1].items[0].data.gas = "500001"; }],
    ["transaction extension", q => { q.steps[1].items[0].data.authorizationList = []; }],
  ];
  for (const [name, edit] of edits) {
    const raw = await fixture(); edit(raw);
    await assert.rejects(validateRelayArbitrumUsdcEthereumUsdcQuote(raw, intent), /Relay Arbitrum quote rejected:|Relay quote rejected:/u, name);
  }
});
