/** Relay token-route quote verification on real solver-signed quotes captured 2026-11-23 for addresses that belong to
 * nobody: an 18-decimal BNB Smart Chain USDT source paid as 6-decimal Base USDC, and 6-decimal Arbitrum USDC paid as
 * 18-decimal BNB USDC. Wrong tokens, decimals, depository, calldata, refunds or signatures refuse. */
import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { assertSavedRelayTokenQuote, relayTokenQuoteRequest, requestRelayTokenQuote, validateRelayTokenQuote, verifySavedRelayTokenQuote,
  type RelayTokenQuoteIntent } from "../../src/relay/token-quote.js";
import { RELAY_TOKEN_DEPOSITORY, relayTokenRouteByReference } from "../../src/relay/token-routes.js";
import { QA_PAYER, QA_RECIPIENT, QA_TOKEN_CAPTURED_AT, quoteFixture } from "./relay-any-profile-harness.js";

const BNB_USDT = "0x55d398326f99059fF775485246999027B3197955", BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OTHER = "0x2222222222222222222222222222222222222222";
const out: RelayTokenQuoteIntent = { routeReference: "bnb-usdt-base-usdc-v1", payer: QA_PAYER.toLowerCase(), recipient: QA_RECIPIENT.toLowerCase(),
  amountAtomic: "5000000000000000000", minimumOutputAtomic: "4800000", nowSeconds: QA_TOKEN_CAPTURED_AT };
const back: RelayTokenQuoteIntent = { ...out, routeReference: "arbitrum-usdc-bnb-usdc-v1", amountAtomic: "5000000",
  minimumOutputAtomic: "4800000000000000000" };
const check = (expected: string) => (error: unknown) => error instanceof ApnError && error.code === "APN_PROVIDER_PROTOCOL" &&
  error.details?.reason === "relay_token_quote_invalid" && error.details?.check === expected;

test("the request names both chains, both token contracts and each side's atomic amount", () => {
  assert.deepEqual(relayTokenQuoteRequest(out), { user: out.payer, originChainId: 56, destinationChainId: 8453,
    originCurrency: BNB_USDT, destinationCurrency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "5000000000000000000",
    tradeType: "EXACT_INPUT", recipient: out.recipient, refundTo: out.payer, includeProtocolData: true, usePermit: false, useDepositAddress: false });
  assert.throws(() => relayTokenQuoteRequest({ ...out, routeReference: "bnb-usdt-optimism-usdc-v1" }), check("route reference"));
  assert.throws(() => relayTokenQuoteRequest({ ...out, amountAtomic: "5.0" }), check("amount"));
});

test("an 18-decimal BNB USDT source validates against a 6-decimal Base USDC minimum, and one POST makes the quote", async () => {
  const raw = await quoteFixture("bnb-usdt-base-usdc");
  const quote = await validateRelayTokenQuote(raw, out);
  assert.deepEqual([quote.schemaVersion, quote.routeReference, quote.sourceDecimals, quote.destinationDecimals],
    ["apn.relay-token-quote.v1", "bnb-usdt-base-usdc-v1", 18, 6]);
  assert.deepEqual([quote.principalAtomic, quote.minimumOutputAtomic, quote.sourceToken, quote.destinationToken],
    ["5000000000000000000", "4868329", BNB_USDT.toLowerCase(), BASE_USDC]);
  assert.equal(quote.paymentDetails.depository, RELAY_TOKEN_DEPOSITORY);
  assert.deepEqual([quote.approval.chainId, quote.deposit.chainId, quote.approval.to, quote.deposit.to], [56, 56, BNB_USDT.toLowerCase(), RELAY_TOKEN_DEPOSITORY]);
  assert.equal(quote.approval.maximumNetworkFeeWei, (60548n * 74750000n).toString());
  assert.equal(quote.statusLocator.requestId, raw.requestId);
  assert.equal(quote.orderId, raw.protocol.v2.orderId.toLowerCase());
  assert.ok(Object.isFrozen(quote) && Object.isFrozen(quote.orderData.inputs[0]!.refunds[1]));
  assert.equal((await validateRelayTokenQuote(await quoteFixture("bnb-usdt-base-usdc"), out)).quoteDigest, quote.quoteDigest);
  assertSavedRelayTokenQuote(quote, relayTokenRouteByReference(quote.routeReference)!);
  assert.equal((await verifySavedRelayTokenQuote(quote)).reference, "bnb-usdt-base-usdc-v1");
  let calls = 0;
  const fetcher = (async (url: unknown, init: RequestInit) => {
    calls += 1; assert.equal(url, "https://api.relay.link/quote/v2"); assert.deepEqual(JSON.parse(String(init.body)), relayTokenQuoteRequest(out));
    return { ok: true, json: async () => await quoteFixture("bnb-usdt-base-usdc") } as Response;
  }) as typeof fetch;
  assert.deepEqual(await requestRelayTokenQuote(out, fetcher, () => out.nowSeconds), quote);
  assert.equal(calls, 1);
});

test("a 6-decimal Arbitrum USDC source validates against an 18-decimal BNB USDC minimum with Arbitrum's zero priority fee", async () => {
  const quote = await validateRelayTokenQuote(await quoteFixture("arbitrum-usdc-bnb-usdc"), back);
  assert.deepEqual([quote.sourceDecimals, quote.destinationDecimals, quote.principalAtomic, quote.minimumOutputAtomic], [6, 18, "5000000", "4866951460000000000"]);
  assert.deepEqual([quote.approval.chainId, quote.approval.maxPriorityFeePerGas], [42161, "0"]);
  // The same quote read as the other BNB token or the other direction is not this route.
  await assert.rejects(validateRelayTokenQuote(await quoteFixture("arbitrum-usdc-bnb-usdc"), { ...back, routeReference: "arbitrum-usdc-bnb-usdt-v1" }), check("order identity"));
  await assert.rejects(validateRelayTokenQuote(await quoteFixture("bnb-usdt-base-usdc"), { ...out, routeReference: "bnb-usdc-base-usdc-v1" }), check("order identity"));
});

test("wrong token, decimals, depository, calldata, chain, refund, call or signature fail closed", async () => {
  const cases: Array<[string, (q: any) => void, string]> = [
    ["input token", q => { q.protocol.v2.orderData.inputs[0].payment.currency = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"; }, "order identity"],
    ["output token", q => { q.protocol.v2.orderData.output.payments[0].currency = "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2"; }, "order identity"],
    ["source decimals", q => { q.details.currencyIn.currency.decimals = 6; }, "token decimals"],
    ["destination decimals", q => { q.details.currencyOut.currency.decimals = 18; }, "token decimals"],
    ["payment depository", q => { q.protocol.v2.paymentDetails.depository = OTHER; }, "payment details"],
    ["deposit target", q => { q.steps[1].items[0].data.to = OTHER; }, "transaction target"],
    ["approval spender", q => { q.steps[0].items[0].data.data = q.steps[0].items[0].data.data.replace(RELAY_TOKEN_DEPOSITORY.slice(2), OTHER.slice(2)); }, "call data"],
    ["approval amount", q => { q.steps[0].items[0].data.data = `${q.steps[0].items[0].data.data.slice(0, -1)}1`; }, "call data"],
    ["deposit token", q => { q.steps[1].items[0].data.data = q.steps[1].items[0].data.data.replace(BNB_USDT.slice(2).toLowerCase(), OTHER.slice(2)); }, "call data"],
    ["approval chain", q => { q.steps[0].items[0].data.chainId = 1; }, "transaction envelope"],
    ["payer", q => { q.steps[1].items[0].data.from = OTHER; }, "transaction envelope"],
    ["source refund", q => { q.protocol.v2.orderData.inputs[0].refunds[0].recipient = OTHER; }, "refund"],
    ["destination call", q => { q.protocol.v2.orderData.output.calls = [{}]; }, "order actions"],
    ["order id", q => { q.protocol.v2.orderId = `0x${"11".repeat(32)}`; }, "order id"],
    ["solver", q => { q.protocol.v2.orderData.solver = OTHER; }, "order identity"],
    ["gas", q => { q.steps[1].items[0].data.gas = "500001"; }, "gas limits"],
    ["expired", q => { q.protocol.v2.orderData.output.deadline = out.nowSeconds; }, "deadline"],
  ];
  for (const [name, edit, expected] of cases) {
    const raw = await quoteFixture("bnb-usdt-base-usdc"); edit(raw);
    await assert.rejects(validateRelayTokenQuote(raw, out), check(expected), name);
  }
  const forged = await quoteFixture("bnb-usdt-base-usdc");
  forged.protocol.v2.orderSignature = `0x${"11".repeat(65)}`;
  await assert.rejects(validateRelayTokenQuote(forged, out), (error: unknown) => error instanceof ApnError && error.code === "APN_PROVIDER_PROTOCOL");
});

test("an existing allowance and a quoted minimum below the caller's are refusals with the values compared", async () => {
  const allowance = await quoteFixture("bnb-usdt-base-usdc"); allowance.steps = [allowance.steps[1]];
  await assert.rejects(validateRelayTokenQuote(allowance, out), (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" &&
    error.details?.reason === "relay_existing_allowance" && error.details?.chain === "eip155:56" && error.details?.asset === BNB_USDT &&
    error.details?.spender === RELAY_TOKEN_DEPOSITORY);
  await assert.rejects(validateRelayTokenQuote(await quoteFixture("bnb-usdt-base-usdc"), { ...out, minimumOutputAtomic: "4868330" }),
    (error: unknown) => error instanceof ApnError && error.details?.reason === "relay_quote_output_below_minimum" &&
      error.details?.quoted_minimum_output_atomic === "4868329" && error.details?.destination_decimals === 6);
});

test("a saved quote whose decimals, token or digest no longer match its route row is refused", async () => {
  const quote = await validateRelayTokenQuote(await quoteFixture("arbitrum-usdc-bnb-usdc"), back);
  const route = relayTokenRouteByReference(quote.routeReference)!;
  const edited = (patch: Record<string, unknown>) => ({ ...structuredClone(quote), ...patch }) as typeof quote;
  for (const patch of [{ destinationDecimals: 6 }, { sourceDecimals: 18 }, { destinationToken: BNB_USDT.toLowerCase() }, { routeReference: "arbitrum-usdc-bnb-usdt-v1" }])
    assert.throws(() => assertSavedRelayTokenQuote(edited(patch), route), check("saved route"), JSON.stringify(patch));
});
