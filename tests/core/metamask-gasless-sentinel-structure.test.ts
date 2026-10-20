import assert from "node:assert/strict";
import test from "node:test";
import { executeHelperRequest } from "../../src/metamask-gasless/client/service.js";
import { MM_HELPER_VERSION, helperResponse } from "../../src/metamask-gasless/client/protocol.js";
import { readDiagnostic, readFailureError, validateReadDiagnostic } from "../../src/metamask-gasless/client/read-diagnostic.js";
import { withMetaMaskProviderRefusal } from "../../src/metamask-gasless/client/provider-refusal.js";
import { NOW, SECRET, SdkExchange, syntheticHome, quoteInput, expectedQuote } from "./metamask-gasless-client-fixtures/sdk.js";

const cases = [
  ["missing", false, undefined], ["null", true, null], ["object", true, { secret: SECRET }],
  ["string", true, SECRET], ["number", true, 42], ["boolean", true, false],
] as const;
const absentFacts = { sentinelSimulation: "absent", sentinelFeeError: "absent", sentinelSponsorship: "absent" } as const;
test("normal pinned quote classifies raw nonarray tokenFees without exposing content; a missing list is MetaMask's answer", async t => {
  for (const [kind, present, value] of cases) await t.test(kind, async t => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
      { homeDirectory: home.home, now: () => NOW, exchange: { async request(r) {
        const response = await exchange.request(r);
        if (r.method !== "POST" || !r.url.includes("tx-sentinel-")) return response;
        const body = JSON.parse(response.body), tier = body.result.transactions[0].fees[0];
        if (present) tier.tokenFees = value; else delete tier.tokenFees;
        return { status: 200, body: JSON.stringify(body) };
      } } });
    assert.equal(result.ok, false); if (result.ok) return;
    const answered = kind === "missing" || kind === "null";
    assert.deepEqual(result.failure, answered ? { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE", reason: "mm_gasless_fee_unquoted" }
      : { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" });
    assert.deepEqual(result.diagnostic, { mode: "quote", stage: "fee_quote", invariant: "network_validation",
      network: "sentinel-quote", httpStatus: 200, exitCode: null, signal: "none", timedOut: false,
      validationPredicate: "sentinel_token_fees", tokenFeesKind: kind, ...absentFacts });
    const error = withMetaMaskProviderRefusal(readFailureError(result.failure.reason, result.diagnostic!), result.diagnostic!, 8453);
    assert.equal(error.details?.mm_read_token_fees_kind, kind);
    assert.equal(error.details?.mm_read_sentinel_simulation, "absent");
    if (answered) {
      assert.equal(error.message, "MetaMask quoted no USDC relay fee for this transfer on Base (chain 8453): its fee quote answered " +
        `HTTP 200 with result.transactions[-1].fees[0].tokenFees ${kind === "missing" ? "missing" : "set to null"} and named no cause ` +
        "APN can verify. APN does not read a missing relay fee as a USDC or native gas shortfall.");
      assert.equal(error.details?.provider_cause, "unverified");
      assert.equal(error.details?.provider_endpoint, "https://agentic-proxy.workers.cx.metamask.io/proxy/prd/tx-sentinel-base-mainnet");
      assert.equal(error.details?.provider_missing_field, "result.transactions[-1].fees[0].tokenFees");
    } else assert.equal(error.message, "MetaMask gasless operation could not advance safely.");
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(exchange.requests.length, 5); assert.equal(exchange.beforeSends, 0);
  });
});
test("valid array preserves exact success envelope and normal quote request count", async t => {
  const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453);
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: true, result: expectedQuote(8453) });
  assert.equal(exchange.requests.length, 6); assert.equal(exchange.beforeSends, 0);
});
test("structural kind is optional, closed, consistent, and forbidden outside its trusted failure", () => {
  const old = readDiagnostic("quote", "fee_quote", "network_validation", "sentinel-quote", 200, null, "none", false, "sentinel_token_fees");
  assert.deepEqual(validateReadDiagnostic(old, "quote"), old);
  const valid = { ...old, tokenFeesKind: "object" };
  assert.deepEqual(validateReadDiagnostic(valid, "quote"), valid);
  let touched = 0;
  const malformed = [
    { ...old, tokenFeesKind: undefined }, { ...old, tokenFeesKind: 1 },
    { ...valid, tokenFeesKind: "array" }, { ...valid, tokenFeesKind: SECRET },
    { ...valid, tokenFeesPresent: true }, { ...valid, validationPredicate: "sentinel_low_tier" },
    { ...valid, stage: "quote_output" }, { ...valid, invariant: "closed_failure" }, { ...valid, network: "mimir-networks" },
    { ...valid, httpStatus: 500 }, { ...valid, extra: SECRET },
    new Proxy(valid, { get() { touched++; throw new Error(SECRET); } }),
    Object.defineProperty({ ...old }, "tokenFeesKind", { enumerable: true, get() { touched++; throw new Error(SECRET); } }),
  ];
  for (const candidate of malformed) assert.throws(() => validateReadDiagnostic(candidate, "quote"));
  assert.equal(touched, 0);
  const request = { version: MM_HELPER_VERSION, mode: "quote", input: {} };
  assert.throws(() => helperResponse({ version: MM_HELPER_VERSION, ok: true, result: {}, diagnostic: valid }, request as never));
  for (const mode of ["inspect", "buildUnsigned", "submit", "observe"])
    assert.throws(() => helperResponse({ version: MM_HELPER_VERSION, ok: false,
      failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" }, diagnostic: valid }, { ...request, mode } as never));
});
test("HTTP and unsourced exceptions cannot manufacture structural provenance", async t => {
  for (const kind of ["http", "foreign"] as const) await t.test(kind, async t => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(8453);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
      { homeDirectory: home.home, now: () => NOW, exchange: { async request(r) {
        if (r.method === "POST" && r.url.includes("tx-sentinel-")) {
          if (kind === "http") return { status: 503, body: JSON.stringify({ tokenFeesKind: "object", secret: SECRET }) };
          throw Object.assign(new Error(SECRET), { tokenFeesKind: "object", validationPredicate: "sentinel_token_fees" });
        }
        return exchange.request(r);
      } } });
    assert.equal(result.ok, false); if (result.ok) return;
    assert.equal(result.diagnostic?.tokenFeesKind, undefined);
    assert.equal(result.diagnostic?.validationPredicate, undefined);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(exchange.beforeSends, 0);
  });
});
