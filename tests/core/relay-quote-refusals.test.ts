/**
 * Regression (QA on 0.5.101, follow-up to the native fix): the Ethereum USDC and Arbitrum USDC Relay routes also threw
 * plain Errors for live quote outcomes, so `relay prepare` answered APN_INTERNAL, and the documented
 * relay_quote_output_below_minimum refusal could not be reached. Each outcome is now classified at prepare, while
 * saved-state validation keeps its plain rejection exactly as before.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { RELAY_ARBITRUM_USDC, validateRelayArbitrumUsdcEthereumUsdcQuote } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { RelayUnsignedPrepareService, RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { relayStatusLocator, requestRelayQuote, validateRelayQuote } from "../../src/relay/quote.js";
import { StateStore } from "../../src/state.js";
import { RELAY_ETHEREUM_USDC_RECIPIENT } from "./relay-legacy-accounts.js";
import { temporaryState } from "./helpers.js";

const owner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14", recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const usdcFixture = async (): Promise<any> => JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
const arbitrumFile = resolve("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json");
const usdcIntent = { payer: owner, recipient, amountAtomic: "2500000", minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 };
const usdcInput = { profile: "default", recipient, amountAtomic: "2500000", minOutputAtomic: "3000000000000000",
  maxApprovalNetworkFeeWei: "30000000000000", maxDepositNetworkFeeWei: "30000000000000", idempotencyKey: "relay-usdc-refusal-0001" };
const arbitrumNow = new Date(1790347296 * 1000);
const arbitrumInput = { profile: "default", owner, recipient: RELAY_ETHEREUM_USDC_RECIPIENT, amountAtomic: "500000", minOutputAtomic: "94065",
  maxProviderFeeAtomic: "401482", maxApprovalNetworkFeeWei: "2000000000000", maxDepositNetworkFeeWei: "2000000000000",
  quoteFile: arbitrumFile, idempotencyKey: "relay-arb-refusal-0001" };
const answering = (response: () => Response | Promise<Response>) => (async () => await response()) as unknown as typeof fetch;
/** Saved-state callers of the shared validators still receive a plain Error named "Error" with the same message. */
const plain = (message: string) => (error: unknown) => !(error instanceof ApnError) && error instanceof Error &&
  error.name === "Error" && error.message === message;

function policy(chain: "eip155:1" | "eip155:42161", expiresAt: string) {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "relay-quote-refusals.1",
    publishedAt: "2026-09-25T00:00:00.000Z", effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z", expiresAt,
    chains: [{ chain, family: "evm", name: chain === "eip155:1" ? "Ethereum" : "Arbitrum One", assets: [{ kind: "token",
      identifier: chain === "eip155:1" ? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" : RELAY_ARBITRUM_USDC, symbol: "USDC", decimals: 6,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: chain === "eip155:1" ? RELAY_ROUTE_REFERENCE : RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1, accounts: { evm: owner },
    activationDigest: "a".repeat(64), activatedAt: "2026-09-25T00:00:00.000Z" };
}

test("Ethereum USDC prepare refuses a signed minimum below the caller's with both values, not APN_INTERNAL", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const active = policy("eip155:1", "2026-10-02T00:00:00.000Z");
  const service = new RelayUnsignedPrepareService(state, { now: () => new Date(usdcIntent.nowSeconds * 1000) }, undefined, {
    activePolicy: async () => active, publicAccount: async () => owner, dailyUsage: async () => "0",
    quote: async intent => await validateRelayQuote(await usdcFixture(), intent) });
  const signed = (await usdcFixture()).protocol.v2.orderData.output.payments[0].minimumAmount as string;
  const above = (BigInt(signed) + 1n).toString();
  const envelope = await new ApnCore({ state, relayPrepare: service }).execute({ command: "relay.prepare", ...usdcInput, minOutputAtomic: above });
  assert.equal(envelope.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(envelope.error));
  assert.deepEqual(envelope.error?.details, { reason: "relay_quote_output_below_minimum",
    quoted_minimum_output_wei: signed, requested_minimum_output_wei: above });
  // Nothing was saved or held: the signed minimum itself prepares.
  const prepared = await service.prepare({ ...usdcInput, minOutputAtomic: signed, idempotencyKey: "relay-usdc-refusal-0002" });
  assert.equal(prepared.state, "prepared");
});

test("Ethereum USDC quote transport and decoding failures are provider errors; the saved-state locator stays plain", async () => {
  await assert.rejects(requestRelayQuote(usdcIntent, answering(() => new Response(JSON.stringify({ message: "too small",
    errorCode: "AMOUNT_TOO_LOW" }), { status: 400 }))), { code: "APN_OPERATION_BLOCKED",
    details: { reason: "relay_quote_refused", http_status: 400, provider_error_code: "AMOUNT_TOO_LOW" } });
  await assert.rejects(requestRelayQuote(usdcIntent, answering(() => new Response("busy", { status: 502 }))),
    { code: "APN_PROVIDER_UNAVAILABLE", details: { reason: "relay_quote_unavailable", http_status: 502 } });
  await assert.rejects(requestRelayQuote(usdcIntent, answering(() => { throw new TypeError("fetch failed"); })),
    { code: "APN_PROVIDER_UNAVAILABLE", details: { reason: "relay_quote_unavailable" } });
  await assert.rejects(requestRelayQuote(usdcIntent, answering(() => new Response("<html>", { status: 200 }))),
    { code: "APN_PROVIDER_PROTOCOL", details: { reason: "relay_quote_invalid", check: "response body" } });
  const hostile = await usdcFixture(); hostile.steps[1].items[0].check = { method: "GET", endpoint: "/intents/status/v3" };
  await assert.rejects(validateRelayQuote(hostile, usdcIntent),
    { code: "APN_PROVIDER_PROTOCOL", details: { reason: "relay_quote_invalid", check: "status locator" } });
  assert.throws(() => relayStatusLocator("0x12"), plain("Relay quote rejected: request id"));
  assert.throws(() => relayStatusLocator(`0x${"ab".repeat(32)}`, "https://evil.example/intents/status/v3"),
    plain("Relay quote rejected: status endpoint"));
});

test("Arbitrum USDC prepare classifies its quote file: below minimum, foreign order and not JSON; saved drafts stay plain", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const active = policy("eip155:42161", "2026-10-03T00:00:00.000Z");
  const service = new RelayUnsignedPrepareService(state, { now: () => arbitrumNow }, undefined,
    { activePolicy: async () => active, dailyUsage: async () => "0" });
  const core = new ApnCore({ state, relayPrepare: service });
  const prepare = async (overrides: Partial<typeof arbitrumInput>) =>
    await core.execute({ command: "relay.arbitrum.prepare", ...arbitrumInput, ...overrides });
  const below = await prepare({ minOutputAtomic: "94066" });
  assert.equal(below.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(below.error));
  assert.deepEqual(below.error?.details, { reason: "relay_quote_output_below_minimum",
    quoted_minimum_output_atomic: "94065", requested_minimum_output_atomic: "94066" });
  // The signed order pays RELAY_ETHEREUM_USDC_RECIPIENT; naming another recipient cannot adopt it.
  const foreign = await prepare({ recipient: owner, idempotencyKey: "relay-arb-refusal-0002" });
  assert.equal(foreign.error?.code, "APN_INVALID_INPUT", JSON.stringify(foreign.error));
  assert.deepEqual(foreign.error?.details, { reason: "relay_arbitrum_quote_invalid", check: "order identity" });
  const broken = join(temporary.base, "not-a-quote.json"); await writeFile(broken, "<html>", { mode: 0o600 });
  const unreadable = await prepare({ quoteFile: broken, idempotencyKey: "relay-arb-refusal-0003" });
  assert.equal(unreadable.error?.code, "APN_INVALID_INPUT", JSON.stringify(unreadable.error));
  assert.deepEqual(unreadable.error?.details, { reason: "relay_arbitrum_quote_invalid", check: "quote file json" });
  const prepared = await prepare({ idempotencyKey: "relay-arb-refusal-0004" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  await assert.rejects(validateRelayArbitrumUsdcEthereumUsdcQuote(JSON.parse(await readFile(arbitrumFile, "utf8")), {
    payer: owner, recipient: owner, amountAtomic: "500000", minimumOutputAtomic: "94065", nowSeconds: Math.floor(arbitrumNow.getTime() / 1000) }),
  plain("Relay Arbitrum quote rejected: order identity"));
});
