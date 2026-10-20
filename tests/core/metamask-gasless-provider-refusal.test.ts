import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { MetaMaskGaslessProviderClient } from "../../src/metamask-gasless/client/process.js";
import type { MetaMaskGaslessChainId } from "../../src/metamask-gasless/model.js";
import { mmFixture } from "./metamask-gasless-helpers.js";
import { NOW, quoteInput, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

/** Provider text that must never cross the helper boundary. */
const PROVIDER_TEXT = "Not enough funds (provider text canary)";

/**
 * QA 0.5.51 rows GASLESS-MM-002..008: HTTP 200 fee quotes whose low fee tier had no `tokenFees` on Arbitrum, Polygon,
 * Ethereum, Linea and Monad. The answer is shaped as the provider sends a simulated transfer it will not price; its
 * tier carries an error but no native gas terms, so no cause is proven (METAMASK-FEE-REFUSAL-ASSET-GUIDANCE-001).
 */
class UnpricedExchange extends SdkExchange {
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    if (request.method !== "POST" || !request.url.includes("tx-sentinel-")) return response;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 10, result: {
      transactions: [{ status: "0x1", fees: [{ error: PROVIDER_TEXT }] }], sponsorship: { isSponsored: false, error: null } } }) };
  }
}
/** QA row GASLESS-MM-005: Optimism refused at relay support; the provider's relay list carries the chain unflagged. */
class UnrelayedExchange extends SdkExchange {
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    if (!request.url.endsWith("/networks")) return response;
    const body = JSON.parse(response.body) as Record<string, Record<string, unknown>>;
    return { status: 200, body: JSON.stringify({ ...body, 10: { ...body["10"], relayTransactions: false } }) };
  }
}
async function clientFor(exchange: SdkExchange) {
  const home = await syntheticHome();
  const client = new MetaMaskGaslessProviderClient({ runner: { run: async (request) =>
    await executeHelperRequest(structuredClone(request), { homeDirectory: home.home, now: () => NOW, exchange }) } });
  return { home, client };
}
const ENDPOINTS: Readonly<Record<number, string>> = { 42161: "arbitrum-mainnet", 137: "polygon-mainnet", 1: "ethereum-mainnet",
  59144: "linea-mainnet", 143: "monad-mainnet" };
const NETWORKS: Readonly<Record<number, string>> = { 42161: "Arbitrum One", 137: "Polygon PoS", 1: "Ethereum", 59144: "Linea", 143: "Monad" };

test("an unpriced MetaMask fee quote without proven terms is refused as the provider's answer and claims no cause", async t => {
  for (const chainId of [42161, 137, 1, 59144, 143] as const) await t.test(String(chainId), async t => {
    const exchange = new UnpricedExchange(chainId), { home, client } = await clientFor(exchange); t.after(home.cleanup);
    const raw = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, chainId) },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.equal(JSON.stringify(raw).includes(PROVIDER_TEXT), false);
    await assert.rejects(client.quote(quoteInput(home.binding, chainId)), (error: unknown) => {
      assert.ok(error instanceof ApnError);
      assert.equal(error.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
      assert.equal(error.message, `MetaMask quoted no USDC relay fee for this transfer on ${NETWORKS[chainId]} (chain ${chainId}): ` +
        "its fee quote answered HTTP 200 with result.transactions[-1].fees[0].tokenFees missing and named no cause APN can verify. " +
        "APN does not read a missing relay fee as a USDC or native gas shortfall.");
      assert.deepEqual(error.details, { reason: "mm_gasless_fee_unquoted", mm_read_mode: "quote", mm_read_stage: "fee_quote",
        mm_read_invariant: "network_validation", mm_read_validation_predicate: "sentinel_token_fees", mm_read_token_fees_kind: "missing",
        mm_read_sentinel_simulation: "succeeded", mm_read_sentinel_fee_error: "present", mm_read_sentinel_sponsorship: "not_sponsored",
        mm_read_network: "sentinel-quote", mm_read_signal: "none", mm_read_timed_out: false, mm_read_http_status: 200,
        provider_read: "metamask-tx-sentinel fee quote",
        provider_endpoint: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/tx-sentinel-${ENDPOINTS[chainId]}`,
        provider_method: "infura_simulateTransactions", provider_missing_field: "result.transactions[-1].fees[0].tokenFees",
        chain_id: chainId, network: NETWORKS[chainId], provider_cause: "unverified" });
      assert.equal(JSON.stringify(error).includes(PROVIDER_TEXT), false);
      return true;
    });
    assert.equal(exchange.beforeSends, 0);
    assert.equal(exchange.requests.some(request => request.url.includes("transaction-requests")), false);
  });
});

test("a relay MetaMask does not offer is refused naming the provider list that withholds it", async t => {
  const exchange = new UnrelayedExchange(10), { home, client } = await clientFor(exchange); t.after(home.cleanup);
  await assert.rejects(client.quote(quoteInput(home.binding, 10)), (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    assert.equal(error.message, "MetaMask offers no gasless relay on OP Mainnet (chain 10): the relay network list " +
      "(https://agentic-proxy.workers.cx.metamask.io/proxy/prd/tx-sentinel-ethereum-mainnet/networks) marks chain 10 relayTransactions false.");
    assert.equal(error.details?.reason, "mm_gasless_relay_unsupported");
    assert.equal(error.details?.mm_read_relay_server_wallet_network, "listed");
    assert.equal(error.details?.mm_read_relay_sentinel_flag, "disabled");
    assert.equal(error.details?.chain_id, 10);
    return true;
  });
  assert.equal(exchange.requests.some(request => request.method === "POST"), false);
});

test("prepare reports the unpriced quote without pointing at USDC and writes nothing", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-refusal-"));
  try {
    const chainId: MetaMaskGaslessChainId = 42161;
    const f = await mmFixture(root, chainId), exchange = new UnpricedExchange(chainId), { home, client } = await clientFor(exchange);
    try {
      let refusal: unknown;
      try { await client.quote(quoteInput(home.binding, chainId)); } catch (error) { refusal = error; }
      f.provider.quote = async () => { throw refusal; };
      const result = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: f.request,
        idempotencyKey: "qa-20261019-mm-42161-unsigned-01" });
      assert.equal(result.ok, false); assert.equal(result.operation, null);
      assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
      assert.equal(result.error?.details?.reason, "mm_gasless_fee_unquoted");
      assert.deepEqual(result.next_actions, ["MetaMask's fee quote named no cause APN can verify, so APN cannot tell whether USDC, " +
        "native gas or the relay itself is short. No operation was written, so the same prepare may run again."]);
      assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 0);
      assert.equal(f.provider.submissions.length, 0);
    } finally { await home.cleanup(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
