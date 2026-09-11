import assert from "node:assert/strict";
import test from "node:test";
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import type { MetaMaskGaslessUnsignedResult } from "../../src/metamask-gasless/model.js";
import { expectedQuote, intent, NOW, OWNER, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

const PRIVATE = "private_provider_metadata_canary";
class StatusExchange extends SdkExchange {
  constructor(readonly patch: Record<string, unknown>, readonly metadata = true) { super(8453); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    if (!request.url.includes("transaction-requests")) return response;
    const current = JSON.parse(response.body);
    return { ...response, body: JSON.stringify({ ...current, ...(this.metadata ? {
      chainName: "base", mode: "server", txIntent: PRIVATE,
      approval: { expiresAt: "2030-01-01T00:10:00.000Z", violations: [
        { policyId: "outflow.limit_usd", reason: "outflow_limit_exceeded", severity: "warn", details: { window: "day" } },
      ], outflow: 0.04 },
      signedTransaction: PRIVATE, txApprovalLink: `https://provider.example/${PRIVATE}`, futureMetadata: { secret: PRIVATE },
    } : {}), ...this.patch }) };
  }
}

test("public SDK response metadata is discarded while MFA and transaction identity remain explicit", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId: 8453, executions: expectedQuote(8453).executions } }, { now: () => NOW });
  assert.equal(built.ok, true); if (!built.ok) return;
  const operation = intent(home.binding, 8453, expectedQuote(8453), built.result as MetaMaskGaslessUnsignedResult);
  for (const metadata of [false, true]) for (const mode of ["submit", "observe"] as const) {
    for (const [status, expected] of [["AWAITING_MFA", "awaiting_approval"], ["EVALUATING", "pending"],
      ["CONFIRMED", "confirmed"]] as const) await t.test(`${mode}/${status}/metadata=${metadata}`, async () => {
      const exchange = new StatusExchange({ status }, metadata);
      const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode, intent: operation },
        { homeDirectory: home.home, now: () => NOW, exchange });
      assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) return;
      assert.equal((result.result as { status: string }).status, expected);
      assert.deepEqual(Object.keys(result.result).sort(), ["observedAt", "requestIdHash", "status", "txHash"]);
      assert.equal(JSON.stringify(result).includes(PRIVATE), false);
      assert.equal(exchange.requests.length, 1);
      assert.equal(exchange.requests[0]!.method, mode === "submit" ? "POST" : "GET");
      assert.equal(exchange.beforeSends, mode === "submit" ? 1 : 0);
    });
  }
});

test("response metadata cannot override a mismatched identity, unknown status, or malformed transaction hash", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId: 8453, executions: expectedQuote(8453).executions } }, { now: () => NOW });
  assert.equal(built.ok, true); if (!built.ok) return;
  const operation = intent(home.binding, 8453, expectedQuote(8453), built.result as MetaMaskGaslessUnsignedResult);
  const cases = [
    { requestId: "other-request" }, { status: "APPROVED" }, { status: "OTHER" }, { txHash: "0x01" },
    { tx: { from: "0x9999999999999999999999999999999999999999", chainId: 8453 } },
    { tx: { from: OWNER, chainId: 1 } }, { tx: { from: OWNER, chainId: "8453" } }, { tx: null },
  ];
  for (const [index, patch] of cases.entries()) await t.test(String(index), async () => {
    const exchange = new StatusExchange({ ...patch, approved: true, success: true });
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "observe", intent: operation },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false,
      failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } });
    assert.equal(exchange.requests.length, 1); assert.equal(exchange.requests[0]!.method, "GET");
    assert.equal(exchange.beforeSends, 0); assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  });
});
