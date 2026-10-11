import assert from "node:assert/strict";
import test from "node:test";
import { HelperNetworkPolicy, networkContextQuote } from "../../src/metamask-gasless/client/network.js";
import { executeHelperRequest } from "../../src/metamask-gasless/client/service.js";
import { MM_HELPER_VERSION, helperResponse } from "../../src/metamask-gasless/client/protocol.js";
import { readDiagnostic, readFailureError, validateReadDiagnostic, type ReadValidationPredicate } from "../../src/metamask-gasless/client/read-diagnostic.js";
import { NOW, quoteInput, SECRET, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

// Mutate one independently specified shape at a time; preceding fields remain valid.
const mutations: [ReadValidationPredicate, (v: any) => void][] = [
  ["sentinel_keys", v => { v.extra = SECRET; }],
  ["sentinel_jsonrpc", v => { v.jsonrpc = "1.0"; }],
  ["sentinel_id", v => { v.id = 11; }],
  ["sentinel_result", v => { v.result = null; }],
  ["sentinel_transactions", v => { v.result.transactions = {}; }],
  ["sentinel_transactions_length", v => { v.result.transactions = []; }],
  ["sentinel_last_transaction", v => { v.result.transactions[0] = null; }],
  ["sentinel_fees", v => { v.result.transactions[0].fees = {}; }],
  ["sentinel_fees_length", v => { v.result.transactions[0].fees = []; }],
  ["sentinel_low_tier", v => { v.result.transactions[0].fees[0] = null; }],
  ["sentinel_token_fees", v => { v.result.transactions[0].fees[0].tokenFees = {}; }],
  ["sentinel_token_fees_length", v => { v.result.transactions[0].fees[0].tokenFees = []; }],
  ["sentinel_entry", v => { v.result.transactions[0].fees[0].tokenFees[0] = null; }],
  ["sentinel_token", v => { v.result.transactions[0].fees[0].tokenFees[0].token = null; }],
  ["sentinel_token_address", v => { v.result.transactions[0].fees[0].tokenFees[0].token.address = SECRET; }],
  ["sentinel_token_match", v => { v.result.transactions[0].fees[0].tokenFees.push(v.result.transactions[0].fees[0].tokenFees[0]); }],
  ["sentinel_entry_error", v => { v.result.transactions[0].fees[0].tokenFees[0].error = SECRET; }],
  ["sentinel_symbol", v => { v.result.transactions[0].fees[0].tokenFees[0].token.symbol = ""; }],
  ["sentinel_decimals", v => { v.result.transactions[0].fees[0].tokenFees[0].token.decimals = 18; }],
  ["sentinel_fee_quantity", v => { v.result.transactions[0].fees[0].tokenFees[0].balanceNeededToken = "0x00"; }],
  ["sentinel_fee_recipient", v => { v.result.transactions[0].fees[0].tokenFees[0].feeRecipient = SECRET; }],
];

test("normal quote first-refusal predicates identify each Sentinel field without changing error identity", async t => {
  for (const [predicate, mutate] of mutations) await t.test(predicate, async t => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
      { homeDirectory: home.home, now: () => NOW, exchange: { async request(r) {
        const response = await exchange.request(r);
        if (r.method !== "POST" || !r.url.includes("tx-sentinel-")) return response;
        const value = JSON.parse(response.body); mutate(value); return { status: 200, body: JSON.stringify(value) };
      } } });
    assert.equal(result.ok, false); if (result.ok) return;
    assert.deepEqual(result.failure, { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" });
    assert.deepEqual(result.diagnostic, { mode: "quote", stage: "fee_quote", invariant: "network_validation",
      network: "sentinel-quote", httpStatus: 200, exitCode: null, signal: "none", timedOut: false, validationPredicate: predicate });
    assert.equal(exchange.requests.length, 5); assert.equal(JSON.stringify(result).includes(SECRET), false);
    const error = readFailureError(result.failure.reason, result.diagnostic!);
    assert.equal(error.details?.mm_read_validation_predicate, predicate);
  });
});

test("JSON syntax and root failures get different fixed predicates; HTTP faults cannot acquire one", async t => {
  for (const [status, body, predicate] of [[200, "{", "response_json"], [200, "[]", "response_root"],
    [401, "{", undefined], [500, "{", undefined]] as const) await t.test(`${status}:${predicate}`, async t => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
      { homeDirectory: home.home, now: () => NOW, exchange: { async request(r) {
        return r.method === "POST" && r.url.includes("tx-sentinel-") ? { status, body } : exchange.request(r);
      } } });
    assert.equal(result.ok, false); if (result.ok) return;
    assert.equal(result.diagnostic?.validationPredicate, predicate);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  });
});

test("optional predicate accepts legacy envelopes and rejects arbitrary/accessor/proxy or wrong-mode metadata", () => {
  const d = readDiagnostic("quote", "fee_quote", "network_validation", "sentinel-quote", 200);
  const request = { version: MM_HELPER_VERSION, mode: "quote" as const, input: {} };
  const failure = { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } as const;
  assert.deepEqual(validateReadDiagnostic(d, "quote"), d);
  assert.equal(validateReadDiagnostic({ ...d, validationPredicate: "sentinel_id" }, "quote").validationPredicate, "sentinel_id");
  let touched = 0;
  for (const candidate of [{ ...d, validationPredicate: SECRET }, { ...d, validationPredicate: 1 },
    { ...d, validationPredicate: "sentinel_id", extra: SECRET },
    { ...d, validationPredicate: "sentinel_id", network: "mimir-networks" },
    { ...d, validationPredicate: "sentinel_id", httpStatus: 500 },
    new Proxy({ ...d, validationPredicate: "sentinel_id" }, { get() { touched++; throw new Error(SECRET); } }),
    Object.defineProperty({ ...d }, "validationPredicate", { enumerable: true, get() { touched++; throw new Error(SECRET); } })]) {
    assert.throws(() => validateReadDiagnostic(candidate, "quote"));
  }
  assert.equal(touched, 0);
  assert.throws(() => helperResponse({ version: MM_HELPER_VERSION, ok: true, result: {}, diagnostic: { ...d, validationPredicate: "sentinel_id" } }, request as never));
  for (const mode of ["inspect", "submit", "observe", "buildUnsigned"] as const)
    assert.throws(() => helperResponse({ version: MM_HELPER_VERSION, ok: false, failure, diagnostic: { ...d, validationPredicate: "sentinel_id" } }, { ...request, mode } as never));
});


test("concurrent policies and unsourced errors cannot steal or forge first-refusal provenance", async t => {
  const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453);
  const input = quoteInput(home.binding, 8453);
  const success = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.equal(success.ok, true);
  const sent = exchange.requests.find(r => r.method === "POST" && r.url.includes("tx-sentinel-"))!;
  const bearer = sent.headers.authorization ?? sent.headers.Authorization;
  assert.equal(typeof bearer, "string");
  const response = await new SdkExchange(8453).request(sent);
  const policies = ["sentinel_id", "sentinel_symbol"].map(predicate => new HelperNetworkPolicy(
    networkContextQuote(input, home.binding.address, bearer!.slice(7)), { async request() {
      const value = JSON.parse(response.body);
      if (predicate === "sentinel_id") value.id = 11;
      else value.result.transactions[0].fees[0].tokenFees[0].token.symbol = "";
      await Promise.resolve(); return { status: 200, body: JSON.stringify(value) };
    } }));
  const errors = await Promise.all(policies.map(p => p.fetch(sent.url, { method: "POST", body: sent.body!, headers: sent.headers }).then(
    () => { throw new Error("unexpected success"); }, error => error)));
  for (const [i, p] of policies.entries()) {
    assert.equal(p.readFailureContext(errors[i]).validationPredicate, i === 0 ? "sentinel_id" : "sentinel_symbol");
    assert.deepEqual(p.readFailureContext(errors[1 - i]), { network: "none", httpStatus: null, validationFailed: false });
    assert.deepEqual(p.readFailureContext(Object.assign(new Error(SECRET), { validationPredicate: "sentinel_id" })),
      { network: "none", httpStatus: null, validationFailed: false });
  }
});
