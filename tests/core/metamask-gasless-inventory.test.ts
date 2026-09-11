import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { expectedQuote, NOW, quoteInput, SECRET, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

type Inventory = "accounts" | "sentinel";
class InventoryExchange extends SdkExchange {
  constructor(readonly inventory: Inventory, readonly replace: (body: Record<string, unknown>) => unknown) { super(8453); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    const matches = this.inventory === "accounts" ? request.url.endsWith("/v2/supportedNetworks") : request.url.endsWith("/networks");
    return matches ? { status: response.status, body: JSON.stringify(this.replace(JSON.parse(response.body))) } : response;
  }
}

test("SDK quote accepts both published Accounts partial-support shapes and rich Sentinel metadata", async (t) => {
  for (const partialSupport of [{}, { "eip155:8453": { ignoredMetadata: true } }, ["eip155:8453"]]) {
    await t.test(Array.isArray(partialSupport) ? "legacy array" : Object.keys(partialSupport).length ? "map" : "empty map", async () => {
      const home = await syntheticHome(); t.after(home.cleanup);
      const exchange = new InventoryExchange("accounts", (body) => ({ ...body, partialSupport }));
      const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
        { homeDirectory: home.home, now: () => NOW, exchange });
      assert.deepEqual(response, { version: MM_HELPER_VERSION, ok: true, result: expectedQuote(8453) });
      assert.equal(exchange.requests.length, 6);
      assert.equal(exchange.requests.filter((request) => request.url.includes("tx-sentinel-") && request.method === "POST").length, 1);
      assert.equal(exchange.requests.some((request) => request.url.includes("transaction-requests")), false);
      assert.equal(exchange.beforeSends, 0);
      assert.equal(await readFile(join(home.directory, "session.json"), "utf8"), home.sessionBytes);
      assert.equal(await readFile(join(home.directory, "wallets.json"), "utf8"), home.walletBytes);
      assert.equal(JSON.stringify(response).includes(SECRET), false);
    });
  }
});

const invalidInventories: readonly { name: string; inventory: Inventory; replace: (body: Record<string, unknown>) => unknown }[] = [
  { name: "null partial support", inventory: "accounts", replace: (body) => ({ ...body, partialSupport: null }) },
  { name: "scalar partial support", inventory: "accounts", replace: (body) => ({ ...body, partialSupport: true }) },
  { name: "non-string legacy entry", inventory: "accounts", replace: (body) => ({ ...body, partialSupport: [1] }) },
  { name: "oversize legacy inventory", inventory: "accounts", replace: (body) => ({ ...body, partialSupport: Array(513).fill("eip155:8453") }) },
  { name: "oversize map inventory", inventory: "accounts", replace: (body) => ({ ...body,
    partialSupport: Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`eip155:${index + 1}`, {}])) }) },
  { name: "non-array full support", inventory: "accounts", replace: (body) => ({ ...body, fullSupport: {} }) },
  { name: "non-string full-support entry", inventory: "accounts", replace: (body) => ({ ...body, fullSupport: [true] }) },
  { name: "oversize full-support inventory", inventory: "accounts", replace: (body) => ({ ...body, fullSupport: Array(513).fill("eip155:8453") }) },
  { name: "missing relay flag", inventory: "sentinel", replace: (body) => ({ ...body, 8453: { name: "Base" } }) },
  { name: "non-boolean relay flag", inventory: "sentinel", replace: (body) => ({ ...body, 8453: { relayTransactions: "true" } }) },
  { name: "non-object network", inventory: "sentinel", replace: (body) => ({ ...body, 8453: [true] }) },
  { name: "noncanonical chain key", inventory: "sentinel", replace: (body) => ({ ...body, "08453": { relayTransactions: true } }) },
  { name: "unsafe chain key", inventory: "sentinel", replace: (body) => ({ ...body, "9007199254740992": { relayTransactions: true } }) },
  { name: "oversize Sentinel inventory", inventory: "sentinel", replace: () => Object.fromEntries(
    Array.from({ length: 513 }, (_, index) => [String(index + 1), { relayTransactions: true }])) },
  { name: "oversize ignored metadata", inventory: "sentinel", replace: (body) => ({ ...body,
    8453: { relayTransactions: true, ignored: "a".repeat(4 * 1024 * 1024) } }) },
];
test("SDK malformed network inventories cannot reach quote RPC or a transaction request", async (t) => {
  for (const row of invalidInventories) await t.test(row.name, async () => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new InventoryExchange(row.inventory, row.replace);
    const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.deepEqual(response, { version: MM_HELPER_VERSION, ok: false,
      failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } });
    assert.equal(exchange.requests.length, 3);
    assert.equal(exchange.requests.some((request) => request.method === "POST"), false);
    assert.equal(exchange.beforeSends, 0);
  });
});

test("SDK disabled relay capability stays unavailable even with rich valid metadata", async (t) => {
  for (const mode of ["disabled", "absent", "sponsorship-only"] as const) await t.test(mode, async () => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const exchange = new InventoryExchange("sentinel", (body) => {
    if (mode === "absent") { delete body["8453"]; return body; }
    return { ...body, 8453: { ...(body["8453"] as Record<string, unknown>), relayTransactions: false,
      sponsorship: { enabled: mode === "sponsorship-only", rules: [] } } };
  });
  const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 8453) },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.deepEqual(response, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE", reason: "mm_gasless_capability_unavailable" } });
  assert.equal(exchange.requests.length, 3);
  assert.equal(exchange.requests.some((request) => request.method === "POST"), false);
  });
});
