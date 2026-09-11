import assert from "node:assert/strict";
import test from "node:test";
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { expectedQuote, NOW, quoteInput, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

class FeeQuantityExchange extends SdkExchange {
  constructor(readonly quantity: string) { super(8453); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    if (request.method !== "POST" || !request.url.includes("tx-sentinel-")) return response;
    const body = JSON.parse(response.body);
    const first = body.result.transactions[0].fees[0].tokenFees[0];
    // The published SDK selects the low tier (index 0), then the explicitly requested token.
    body.result.transactions[0] = { status: "0x1", gasUsed: "0x10000", fees: [this.quantity, "0x7d0", "0xbb8", "0xfa0"].map(
      (balanceNeededToken) => ({ error: "", tokenFees: [{ ...first, balanceNeededToken, currentBalanceToken: "0x2540be400",
        serviceFee: "0x0", error: "", isDelegationFee: true }] })), feeEstimate: 1, baseFeePerGas: 1 };
    body.result.sponsorship = { isSponsored: false, error: "" };
    return { ...response, body: JSON.stringify(body) };
  }
}

test("public SDK quote accepts decimal and canonical hexadecimal fees with the same token debit", async (t) => {
  for (const quantity of ["1000", "0x3e8", "0x3E8"]) await t.test(quantity, async () => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new FeeQuantityExchange(quantity);
    const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.deepEqual(response, { version: MM_HELPER_VERSION, ok: true, result: expectedQuote(8453) });
    assert.equal(exchange.requests.length, 6);
    assert.equal(exchange.requests.filter((request) => request.url.includes("rpc.example.test")).length, 2);
    assert.equal(exchange.requests.filter((request) => request.url.includes("tx-sentinel-") && request.method === "POST").length, 1);
    assert.equal(exchange.requests.some((request) => request.url.includes("transaction-requests")), false);
    assert.equal(exchange.beforeSends, 0);
  });
});

test("malformed or overflowing Sentinel fee quantities cannot reach a payment request", async (t) => {
  for (const quantity of ["-1", " 1000", "1000 ", "1e3", "1.0", "0x", "0x00", "0x03e8", "0x-1", "0x+1", "0xgg",
    `0x1${"0".repeat(64)}`, (2n ** 256n).toString()]) await t.test(quantity.slice(0, 24), async () => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new FeeQuantityExchange(quantity);
    const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.deepEqual(response, { version: MM_HELPER_VERSION, ok: false,
      failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } });
    assert.equal(exchange.requests.length, 5);
    assert.equal(exchange.requests.some((request) => request.url.includes("transaction-requests")), false);
    assert.equal(exchange.beforeSends, 0);
  });
});
