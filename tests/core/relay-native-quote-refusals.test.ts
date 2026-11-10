/**
 * Regression (QA on 0.5.101): `relay prepare` Base ETH to Polygon POL under an active owner policy answered
 * APN_INTERNAL «failed safely» (internal_class Error). Every Relay native quote outcome threw a plain Error: a quote
 * Relay declines (HTTP 400 AMOUNT_TOO_LOW / NO_SWAP_ROUTES_FOUND), a signed minimum output below the caller's minimum and
 * a Base L2 fee above the caller's ceiling (both move with the market, so the same inputs pass a minute later), and a
 * malformed answer. Each is now a classified error with its reason; nothing is saved.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { RELAY_BASE_POLYGON_ROUTE_REFERENCE, requestRelayNativeQuote, validateRelayNativeQuote,
  type RelayNativeQuoteIntent } from "../../src/relay/native-quote.js";
import { QA_CAPTURED_AT, QA_PAYER, QA_RECIPIENT, admitBridge, assertNonOwner, importPayer, qaWorld, quoteFixture,
  type QaWorld, type QuoteName } from "./relay-any-profile-harness.js";

const PROFILE = "relay-qa-base-polygon-refusals";
const AMOUNT = "60000000000000", MIN_OUT = "1000000000000000000", FEE = "1500000000000";
const intent: RelayNativeQuoteIntent = { payer: QA_PAYER.toLowerCase(), recipient: QA_RECIPIENT.toLowerCase(), amountAtomic: AMOUNT,
  minimumOutputWei: MIN_OUT, nowSeconds: QA_CAPTURED_AT, routeReference: RELAY_BASE_POLYGON_ROUTE_REFERENCE, maximumNetworkFeeWei: FEE };

function prepareArgs(key: string, minOut = MIN_OUT, fee = FEE): string[] {
  return ["relay", "prepare", "--profile", PROFILE, "--source-chain", "eip155:8453", "--asset", "native",
    "--destination-chain", "eip155:137", "--recipient", QA_RECIPIENT, "--amount-atomic", AMOUNT,
    "--min-output-atomic", minOut, "--max-deposit-network-fee-wei", fee, "--idempotency-key", key];
}
/** The profile's own wallet and active owner policy admitting Base native over the Relay Base to Polygon pin. */
async function admitted(t: TestContext, quote: QuoteName | null): Promise<QaWorld> {
  assertNonOwner(PROFILE, QA_PAYER, QA_RECIPIENT);
  const world = await qaWorld(t, quote);
  await importPayer(world, PROFILE);
  await admitBridge(world, PROFILE, { chain: "eip155:8453", asset: null, reference: RELAY_BASE_POLYGON_ROUTE_REFERENCE,
    maximumPerTransferAtomic: AMOUNT, dailyLimitAtomic: (BigInt(AMOUNT) * 2n).toString() });
  return world;
}
const answering = (response: () => Response | Promise<Response>) => (async () => await response()) as unknown as typeof fetch;

test("Base to Polygon prepare refuses a signed minimum below the caller's and a Base fee above the ceiling, never APN_INTERNAL", async t => {
  const world = await admitted(t, "base-native-polygon-native");
  const raw = await quoteFixture("base-native-polygon-native");
  const signed = raw.protocol.v2.orderData.output.payments[0].minimumAmount as string;
  const l2Fee = (BigInt(raw.steps[0].items[0].data.gas) * BigInt(raw.steps[0].items[0].data.maxFeePerGas)).toString();
  const above = (BigInt(signed) + 1n).toString(), below = (BigInt(l2Fee) - 1n).toString();
  const output = await world.cli(prepareArgs("relay-refusal-0001", above));
  assert.equal(output.ok, false);
  assert.equal(output.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(output.error));
  assert.deepEqual(output.error?.details, { reason: "relay_quote_output_below_minimum",
    quoted_minimum_output_wei: signed, requested_minimum_output_wei: above });
  const fee = await world.cli(prepareArgs("relay-refusal-0002", MIN_OUT, below));
  assert.equal(fee.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(fee.error));
  assert.deepEqual(fee.error?.details, { reason: "relay_deposit_fee_above_ceiling", quoted_fee_wei: l2Fee, fee_ceiling_wei: below });
  // Nothing was saved or held: the signed bounds themselves prepare at once.
  const prepared = await world.cli(prepareArgs("relay-refusal-0003", signed, l2Fee));
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  assert.equal(world.quoteRequests.length, 3);
});

test("Relay declining the Base to Polygon quote is a refusal with its own code", async t => {
  const world = await admitted(t, null);
  const declined = await world.cli(prepareArgs("relay-refusal-0101"), { relayPreparePorts: {
    nativeQuote: (quoteIntent: RelayNativeQuoteIntent) => requestRelayNativeQuote(quoteIntent, answering(() => new Response(JSON.stringify({
      message: "Swap output amount is too small to cover fees required to execute swap", errorCode: "AMOUNT_TOO_LOW" }), { status: 400 }))) } });
  assert.equal(declined.ok, false);
  assert.equal(declined.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(declined.error));
  assert.deepEqual(declined.error?.details, { reason: "relay_native_quote_refused", http_status: 400, provider_error_code: "AMOUNT_TOO_LOW" });
});

test("Relay quote transport and decoding failures are provider errors, not internal ones", async () => {
  const unavailable = (http_status?: number) => ({ code: "APN_PROVIDER_UNAVAILABLE",
    details: { reason: "relay_native_quote_unavailable", ...(http_status === undefined ? {} : { http_status }) } });
  await assert.rejects(requestRelayNativeQuote(intent, answering(() => { throw new TypeError("fetch failed"); })), unavailable());
  await assert.rejects(requestRelayNativeQuote(intent, answering(() => new Response("busy", { status: 503 }))), unavailable(503));
  await assert.rejects(requestRelayNativeQuote(intent, answering(() => new Response("{}", { status: 429 }))), unavailable(429));
  // A declined quote shows Relay's code only when it is a plain machine code; its free text never is.
  await assert.rejects(requestRelayNativeQuote(intent, answering(() => new Response("<html>", { status: 400 }))),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "relay_native_quote_refused", http_status: 400 } });
  await assert.rejects(requestRelayNativeQuote(intent, answering(() => new Response(JSON.stringify({ errorCode: "too low <b>" }), { status: 422 }))),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "relay_native_quote_refused", http_status: 422 } });
  const invalid = (check: string) => ({ code: "APN_PROVIDER_PROTOCOL", details: { reason: "relay_native_quote_invalid", check } });
  await assert.rejects(requestRelayNativeQuote(intent, answering(() => new Response("<html>", { status: 200 }))), invalid("response body"));
  const edits: Array<[string, (q: any) => void]> = [
    ["order identity", q => { q.protocol.v2.orderData.output.payments[0].currency = "0x0000000000000000000000000000000000001010"; }],
    ["status locator", q => { q.steps[0].items[0].check.endpoint = "/intents/status/v3"; }],
    ["gas limits", q => { q.steps[0].items[0].data.maxFeePerGas = "100000000001"; }],
  ];
  for (const [check, edit] of edits) {
    const q = await quoteFixture("base-native-polygon-native"); edit(q);
    await assert.rejects(validateRelayNativeQuote(q, intent), invalid(check), check);
  }
});
