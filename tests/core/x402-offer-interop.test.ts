import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { canonicalJson } from "../../src/canonical.js";
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader } from "../../src/x402-codec.js";
import { x402Asset } from "../../src/x402-network.js";
import { inspectOffers } from "../../src/x402-offer-inspect.js";
import { X402_OFFER_MAX_TIMEOUT_SECONDS } from "../../src/x402-offer-terms.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { X402_EXACT_PERMIT2_PROXY, wirePermit2Asset } from "../../src/x402-permit2/registry.js";
import { validateX402Operation } from "../../src/x402-state-integrity.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { admitAsset, assetFixture, type AssetCase } from "./x402-any-asset-helpers.js";
import { challengeObservation, paidObservation } from "./x402-helpers.js";
import { X402_TRANSACTION, canonicalPaymentRequiredHeader, canonicalPaymentResponseHeader } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const CAPTURED = JSON.parse(readFileSync("tests/fixtures/x402/edifiedlab-base-usdc-permit2-challenge.json", "utf8")) as {
  readonly paymentRequired: { readonly resource: { readonly url: string }; readonly accepts: readonly Record<string, unknown>[] } };
const URL_ = CAPTURED.paymentRequired.resource.url;
const OFFER = CAPTURED.paymentRequired.accepts[0]!;
const BASE_USDC: AssetCase = { label: "Base USDC", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2", decimals: 6 };
const PAYER = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as `0x${string}`;

/** The captured challenge, or a local counterfactual of it (never sent anywhere): offer fields and `extra` keys replaced. */
function edified(offer: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const changed = { ...OFFER, ...offer, extra: Object.fromEntries(Object.entries({ ...(OFFER.extra as object), ...extra }).filter(([, value]) => value !== undefined)) };
  return { ...CAPTURED.paymentRequired, accepts: [changed] };
}
const inspect = (value: unknown) => inspectOffers(decodePaymentRequiredHeader(canonicalPaymentRequiredHeader(value)), URL_, x402Asset(8453));
const prepare = (key: string) => ({ command: "x402.fetch.prepare" as const, profile: "default", chainId: 8453, asset: BASE_USDC.token, url: URL_, idempotencyKey: key });

test("the captured edifiedlab Base USDC Permit2-only offer is a candidate: 600 s is inside the bound, its extra keys are understood or carried", () => {
  const inspected = inspect(CAPTURED.paymentRequired);
  assert.deepEqual(inspected.refused, []);
  const [candidate] = inspected.candidates;
  assert.equal(candidate?.assetTransferMethod, "permit2");
  assert.equal(candidate?.maxTimeoutSeconds, "600");
  assert.equal(candidate?.amountAtomic, "11000");
  assert.equal(candidate?.payTo, "0x5037546753d64f77a6fa95b6f85659b6a4a7f6fd");
  assert.equal(X402_OFFER_MAX_TIMEOUT_SECONDS, 3600);
  // The same offer passes the Permit2 wire selector every signed payload is checked by, unchanged (challengeId and all).
  const selection = selectPermit2Offer(CAPTURED.paymentRequired.accepts, PAYER, wirePermit2Asset);
  assert.equal(selection.maxTimeoutSeconds, 600);
  assert.equal(canonicalJson(selection.requirement), canonicalJson(OFFER));
  // Keys APN does not understand are never a reason to refuse.
  assert.equal(inspect(edified({}, { signerAddress: PAYER, x402PaymentConfigId: "cfg-1", chainId: "8453" })).candidates.length, 1);
  assert.equal(inspect(edified({ maxTimeoutSeconds: 3600 })).candidates.length, 1);
});

for (const [label, offer, extra, reason, field, value, expected] of [
  ["a seven-day window", { maxTimeoutSeconds: 604800 }, {}, "x402_offer_timeout_exceeds_bound", "maxTimeoutSeconds", "604800", "30..3600"],
  ["a window one second over the bound", { maxTimeoutSeconds: 3601 }, {}, "x402_offer_timeout_exceeds_bound", "maxTimeoutSeconds", "3601", "30..3600"],
  ["a window under the lower bound", { maxTimeoutSeconds: 20 }, {}, "x402_offer_timeout_below_bound", "maxTimeoutSeconds", "20", "30..3600"],
  ["another spender", {}, { spenderAddress: "0x3038f7ac3b4D1a3fe886BdCB5cD01e9f6BDd8633" }, "x402_offer_spender_mismatch", "extra.spenderAddress",
    "0x3038f7ac3b4D1a3fe886BdCB5cD01e9f6BDd8633", X402_EXACT_PERMIT2_PROXY],
  ["another chain id", {}, { chainId: 1 }, "x402_offer_chain_mismatch", "extra.chainId", "1", "8453"],
  ["another transfer method", {}, { assetTransferMethod: "permit2-exact" }, "x402_offer_method_unsupported", "extra.assetTransferMethod", "permit2-exact",
    "eip3009, permit2 or erc7710"],
  ["a name without a version", {}, { version: undefined }, "x402_offer_extra_invalid", "extra.version", undefined, "the token's EIP-712 domain name and version"],
  ["decimals that are not USDC's", {}, { decimals: 18 }, "x402_token_decimals_mismatch", "extra.decimals", "18", "6"],
] as const) test(`a local counterfactual of the captured offer with ${label} is refused by name, with the seller's value and what APN accepts`, () => {
  const inspected = inspect(edified(offer, extra));
  assert.deepEqual(inspected.candidates, []);
  assert.deepEqual(inspected.refused, [{ index: "0", network: "eip155:8453", asset: BASE_USDC.token.toLowerCase(),
    method: extra.assetTransferMethod ?? "permit2", reason, field, ...(value === undefined ? {} : { value }), expected }]);
});

test("the captured challenge pays through unattended x402 fetch: one witness signature, accepted and resource echoed unchanged, the nonce bit settles it", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await admitAsset(fixture, BASE_USDC);
  fixture.http.outcomes[0] = challengeObservation({ header: canonicalPaymentRequiredHeader(CAPTURED.paymentRequired), finalUrl: URL_ });
  const prepared = await fixture.core.execute(prepare("edified-permit2-0001"));
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = (prepared.operation as { operationId: string }).operationId;
  const frozen = validateX402Operation((await fixture.state.findX402Operation(operationId))!);
  assert.deepEqual(frozen.selectedOffer.resolved, { assetTransferMethod: "permit2", paymentFlow: "permit2WitnessTransfer", eip2612: null });
  assert.equal(frozen.selectedOffer.declaredCanonicalJson, canonicalJson(OFFER));
  assert.equal(BigInt(frozen.authorization.validBefore) - BigInt(frozen.authorization.createdAt), 600n);
  assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  assert.deepEqual(fixture.nativeCalls.map((call) => call.operation).filter((operation) => operation.startsWith("x402")), ["x402Permit2.approveAndAuthorize"]);
  const now = new Date().toISOString();
  fixture.http.outcomes.push(paidObservation({ finalUrl: URL_, startedAt: now, observedAt: now, bodyText: '{"regime":"calm"}',
    paymentResponseHeader: canonicalPaymentResponseHeader({ success: true, transaction: X402_TRANSACTION, network: "eip155:8453", payer: frozen.wallet, amount: "11000" }) }));
  const paid = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(paid.ok, true, JSON.stringify(paid));
  const sent = fixture.http.calls.filter((call) => call.paymentSignature !== undefined);
  assert.equal(sent.length, 1);
  const payload = decodePaymentSignatureHeader(sent[0]!.paymentSignature!);
  assert.equal(canonicalJson(payload.accepted), canonicalJson(OFFER), "challengeId, chainId and spenderAddress go back exactly as offered");
  assert.equal(canonicalJson(payload.resource), canonicalJson(CAPTURED.paymentRequired.resource), "serviceName and tags go back exactly as offered");
  const authorization = (payload.payload as { permit2Authorization: { spender: string; deadline: string } }).permit2Authorization;
  assert.equal(authorization.spender, X402_EXACT_PERMIT2_PROXY); assert.equal(authorization.deadline, frozen.authorization.validBefore);
  fixture.rpc.permit2.used = true;
  const completed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((completed.operation as { state: string }).state, "completed", JSON.stringify(completed));
  assert.deepEqual((completed.data as { body?: unknown }).body, { regime: "calm" });
  assert.equal(fixture.http.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
});

test("CLI and MCP refuse a 7,200-second counterfactual with the same named reason, seller value and bound", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC);
  const challenge = () => challengeObservation({ header: canonicalPaymentRequiredHeader(edified({ maxTimeoutSeconds: 7200 })), finalUrl: URL_ });
  fixture.http.outcomes.splice(0, fixture.http.outcomes.length, challenge(), challenge());
  const options = { stateRoot: temporary.root, wrappingSecret: fixture.wrapping, http: fixture.http, clock: fixture.clock };
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-offer-refusal-parity", version: "1.0.0" }); await client.connect(clientTransport);
  context.after(async () => { await client.close(); await server.close(); });
  const input = { url: URL_, chain: "eip155:8453", asset: BASE_USDC.token };
  const mcp = (await client.callTool({ name: "apn_x402_inspect", arguments: input })).structuredContent as unknown as OutputEnvelope;
  const cli = await runCli(["x402", "inspect", "--url", URL_, "--chain", "eip155:8453", "--asset", BASE_USDC.token], {}, options);
  assert.deepEqual(cli.error, mcp.error);
  assert.equal(cli.error?.code, "APN_X402_UNSUPPORTED_OFFER");
  assert.deepEqual(cli.error?.details, { reason: "x402_offer_timeout_exceeds_bound", field: "maxTimeoutSeconds", sellerValue: "7200", accepted: "30..3600",
    refused: [`offer 0 eip155:8453 ${BASE_USDC.token.toLowerCase()} permit2: x402_offer_timeout_exceeds_bound maxTimeoutSeconds=7200 (APN accepts 30..3600)`],
    chain: "eip155:8453", asset: BASE_USDC.token, offered: [`eip155:8453 ${BASE_USDC.token.toLowerCase()} permit2`] });
  assert.match(cli.error?.message ?? "", /offer 0 .* was refused: x402_offer_timeout_exceeds_bound maxTimeoutSeconds=7200/u);
});

test("a challenge whose resource is another URL is refused as such, not as an offer the seller lacks", () => {
  const inspected = inspectOffers(decodePaymentRequiredHeader(canonicalPaymentRequiredHeader(CAPTURED.paymentRequired)), `${URL_}?instrument=ES`, x402Asset(8453));
  assert.deepEqual(inspected.candidates, []);
  assert.equal(inspected.resourceMismatch, URL_);
});

test("the Permit2 selector names the deciding field of an admitted offer it cannot sign", () => {
  assert.throws(() => selectPermit2Offer(edified({ maxTimeoutSeconds: 7200 }).accepts, PAYER, wirePermit2Asset), (error: unknown) =>
    (error as { details?: Record<string, unknown> }).details?.reason === "x402_offer_timeout_exceeds_bound" &&
    (error as { details?: Record<string, unknown> }).details?.sellerValue === "7200" && (error as { details?: Record<string, unknown> }).details?.accepted === "1..3600");
  assert.throws(() => selectPermit2Offer(edified({}, { spenderAddress: PAYER }).accepts, PAYER, wirePermit2Asset), (error: unknown) =>
    (error as { details?: Record<string, unknown> }).details?.reason === "x402_offer_spender_mismatch");
});
