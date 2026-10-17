import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { ApnCore } from "../../src/core.js";
import { OperationService } from "../../src/operation-service.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { RelayRetireService } from "../../src/relay/retire.js";
import { RELAY_BNB_MONAD_ROUTE_REFERENCE, RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE, relayNativeQuoteRequest,
  validateRelayNativeQuote } from "../../src/relay/native-quote.js";
import { relayNativeRouteByReference, relayNativeRouteFor } from "../../src/relay/native-routes.js";
import { RELAY_BNB_DEFAULT_SOURCE, RELAY_BNB_SOURCE } from "./relay-legacy-accounts.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const fixture = async (): Promise<any> => JSON.parse(await readFile(
  "tests/core/relay-fixtures/bnb-native-monad-native-quote-20260925.json", "utf8"));
const defaultFixture = async (): Promise<any> => JSON.parse(await readFile(
  "tests/core/relay-fixtures/bnb-native-monad-native-default-quote-20260925.json", "utf8"));
const instant = new Date("2026-09-25T12:00:00.000Z");
const intent = { payer: RELAY_BNB_SOURCE, recipient: RELAY_BNB_SOURCE,
  amountAtomic: "1500000000000000", minimumOutputWei: "40000000000000000000",
  nowSeconds: Math.floor(instant.getTime() / 1000), routeReference: RELAY_BNB_MONAD_ROUTE_REFERENCE,
  maximumNetworkFeeWei: "30000000000000" };
const input = { profile: "evm-live-buyer", sourceChain: "eip155:56", destinationChain: "eip155:143", recipient: RELAY_BNB_SOURCE, amountAtomic: intent.amountAtomic,
  minOutputAtomic: intent.minimumOutputWei, maxDepositNetworkFeeWei: "30000000000000",
  idempotencyKey: "relay-bnb-mon-0001" };
function policy(reference = RELAY_BNB_MONAD_ROUTE_REFERENCE) {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "relay-monad.test.1",
    publishedAt: "2026-09-25T00:00:00.000Z", effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:56", family: "evm", name: "BNB Smart Chain",
      assets: [{ kind: "native", identifier: null, symbol: "BNB", decimals: 18,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "2000000000000000", dailyLimitAtomic: "3000000000000000" } },
        mechanismPins: { bridge: { provider: "relay", reference } } }] }] });
  return { profile: input.profile, registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: RELAY_BNB_SOURCE }, activationDigest: "a".repeat(64), activatedAt: instant.toISOString() };
}

test("the owner-named default Monad reference decodes the same physical route; new prepares use the owner-free one", () => {
  const legacy = relayNativeRouteByReference(RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE);
  const current = relayNativeRouteFor(56, 143);
  assert.equal(legacy?.legacy, true); assert.equal(current?.reference, RELAY_BNB_MONAD_ROUTE_REFERENCE);
  assert.deepEqual({ ...legacy, reference: undefined, legacy: undefined }, { ...current, reference: undefined, legacy: undefined });
  assert.equal(relayNativeRouteFor(56, 4326), null); assert.equal(relayNativeRouteFor(8453, 143), null);
  // Any payer and any recipient: identity is the caller's, the route only names chains and currencies (OWNR-03).
  for (const pair of [{ payer: RELAY_BNB_DEFAULT_SOURCE, recipient: RELAY_BNB_DEFAULT_SOURCE },
    { payer: RELAY_BNB_DEFAULT_SOURCE, recipient: RELAY_BNB_SOURCE },
    { payer: RELAY_BNB_SOURCE, recipient: "0x1111111111111111111111111111111111111111" }]) {
    const request = relayNativeQuoteRequest({ ...intent, ...pair, amountAtomic: "1200000000000000", minimumOutputWei: "1" });
    assert.equal(request.user, pair.payer); assert.equal(request.refundTo, pair.payer);
    assert.equal(request.recipient, pair.recipient); assert.equal(request.destinationChainId, 143);
  }
});

test("native prepare of the default profile names the owner-free route; a legacy-only pin admits no new prepare", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const defaultInput = { ...input, profile: "default", recipient: RELAY_BNB_DEFAULT_SOURCE,
    amountAtomic: "1200000000000000", idempotencyKey: "relay-bnb-mon-default-0001" };
  const intents: { routeReference: string; payer: string; recipient: string }[] = [];
  const service = (reference: string, account = RELAY_BNB_DEFAULT_SOURCE, wallet = account) => new RelayUnsignedPrepareService(
    state, { now: () => instant }, undefined, { activePolicy: async () => ({ ...policy(reference),
      profile: "default", accounts: { evm: account } }), publicAccount: async () => wallet,
      dailyUsage: async () => "0", nativeQuote: async i => { intents.push(i); throw new Error("stop after the quote intent"); } });
  await assert.rejects(service(RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE).prepareNative(defaultInput),
    { code: "APN_ALLOWLIST_REFUSED", details: { reason: "relay_native_route_pin_required" } });
  await assert.rejects(service(RELAY_BNB_MONAD_ROUTE_REFERENCE, RELAY_BNB_DEFAULT_SOURCE, RELAY_BNB_SOURCE).prepareNative(defaultInput),
    { code: "APN_ALLOWLIST_REFUSED", details: { reason: "relay_public_profile_owner_mismatch" } });
  assert.equal(intents.length, 0);
  await assert.rejects(service(RELAY_BNB_MONAD_ROUTE_REFERENCE).prepareNative({ ...defaultInput, recipient: RELAY_BNB_SOURCE }),
    /stop after the quote intent/u);
  assert.deepEqual(intents.map(i => [i.routeReference, i.payer, i.recipient]),
    [[RELAY_BNB_MONAD_ROUTE_REFERENCE, RELAY_BNB_DEFAULT_SOURCE.toLowerCase(), RELAY_BNB_SOURCE.toLowerCase()]]);
});

test("the default profile's Monad quote prepares under the owner-free reference (RELAY-004 is RELAY-003's route)", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root), raw = await defaultFixture();
  const defaultInput = { ...input, profile: "default", recipient: RELAY_BNB_DEFAULT_SOURCE,
    amountAtomic: "1200000000000000", minOutputAtomic: "32000000000000000000",
    idempotencyKey: "relay-bnb-mon-default-0002" };
  const quote = await validateRelayNativeQuote(raw, { ...intent, payer: RELAY_BNB_DEFAULT_SOURCE,
    recipient: RELAY_BNB_DEFAULT_SOURCE, amountAtomic: defaultInput.amountAtomic,
    minimumOutputWei: defaultInput.minOutputAtomic });
  assert.equal(quote.routeReference, RELAY_BNB_MONAD_ROUTE_REFERENCE);
  assert.equal(quote.deposit.value, "1200000000000000");
  const p = policy(RELAY_BNB_MONAD_ROUTE_REFERENCE);
  const active = { ...p, profile: "default", accounts: { evm: RELAY_BNB_DEFAULT_SOURCE } };
  let calls = 0;
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined,
    { activePolicy: async () => active, publicAccount: async () => RELAY_BNB_DEFAULT_SOURCE,
      dailyUsage: async () => "0", nativeQuote: async () => { calls++; return quote; } });
  const first = await service.prepareNative(defaultInput);
  assert.equal(first.sourceAccount, RELAY_BNB_DEFAULT_SOURCE.toLowerCase());
  assert.equal(first.recipient, RELAY_BNB_DEFAULT_SOURCE.toLowerCase());
  assert.equal(first.nativeQuote?.routeReference, RELAY_BNB_MONAD_ROUTE_REFERENCE);
  assert.equal(JSON.stringify(first).includes(raw.requestId), false);
  assert.deepEqual(await service.prepareNative(defaultInput), first);
  assert.equal(calls, 1);
  const retired = await new RelayRetireService(state, { now: () => instant }, {
    load: async () => { throw new Error("unexpected secret read"); },
    create: async () => { throw new Error("unexpected secret creation"); },
  }).retire({ profile: "default", operationId: first.operationId });
  assert.equal(retired.state, "retired");
});

test("BNB to Monad native buyer quote binds one unsigned deposit and exact order", async () => {
  assert.deepEqual(relayNativeQuoteRequest(intent), { user: RELAY_BNB_SOURCE, originChainId: 56,
    destinationChainId: 143, originCurrency: "0x0000000000000000000000000000000000000000",
    destinationCurrency: "0x0000000000000000000000000000000000000000", amount: intent.amountAtomic,
    tradeType: "EXACT_INPUT", recipient: RELAY_BNB_SOURCE, refundTo: RELAY_BNB_SOURCE,
    includeProtocolData: true, usePermit: false, useDepositAddress: false });
  const quote = await validateRelayNativeQuote(await fixture(), intent);
  assert.equal(quote.routeReference, RELAY_BNB_MONAD_ROUTE_REFERENCE);
  assert.equal(quote.minimumOutputWei, "40701153187861158456");
  assert.equal(quote.deposit.value, intent.amountAtomic);
  assert.equal(quote.deposit.maximumNetworkFeeWei, "18706383855142");
  assert.equal((quote.orderData as any).inputs[0].refunds[1].currency,
    "0x0000000000000000000000000000000000000000");
  assert.ok(Object.isFrozen(quote) && Object.isFrozen(quote.deposit));
});

test("Monad native quote rejects Polygon lane, extra destination effects and expired order", async () => {
  const changes: Array<[string, (q: any) => void]> = [
    ["Polygon output", q => { q.protocol.v2.orderData.output.chainId = "polygon"; }],
    ["Polygon details", q => { q.details.currencyOut.currency.chainId = 137; }],
    ["Polygon refund", q => { q.protocol.v2.orderData.inputs[0].refunds[1].currency = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"; }],
    ["foreign recipient", q => { q.protocol.v2.orderData.output.payments[0].recipient = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14"; }],
    ["source token", q => { q.protocol.v2.orderData.inputs[0].payment.currency = "0x55d398326f99059fF775485246999027B3197955"; }],
    ["destination call", q => { q.protocol.v2.orderData.output.calls.push({}); }],
    ["wrong depository", q => { q.protocol.v2.paymentDetails.depository = RELAY_BNB_SOURCE; }],
    ["changed value", q => { q.steps[0].items[0].data.value = "1"; }],
    ["expired", q => { q.protocol.v2.orderData.output.deadline = intent.nowSeconds; }],
  ];
  for (const [name, change] of changes) {
    const q = await fixture(); change(q);
    await assert.rejects(validateRelayNativeQuote(q, intent), /Relay native quote rejected:/, name);
  }
});

test("Monad prepare persists policy-bound unsigned operation and replays without a second quote", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); let calls = 0;
  const service = (reference = RELAY_BNB_MONAD_ROUTE_REFERENCE) => new RelayUnsignedPrepareService(
    state, { now: () => instant }, undefined, { activePolicy: async () => policy(reference),
      publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
      nativeQuote: async quoteIntent => { calls++; return validateRelayNativeQuote(await fixture(), quoteIntent); } });
  await assert.rejects(service("bnb-native-polygon-native-v1").prepareNative(input), { code: "APN_ALLOWLIST_REFUSED" });
  assert.equal(calls, 0);
  const commandInput = { command: "relay.native.prepare" as const, ...input };
  const first = await service().prepareNative(commandInput);
  assert.equal(first.sourceChainId, 56); assert.equal(first.destinationChainId, 143);
  assert.equal(first.recipient, RELAY_BNB_SOURCE.toLowerCase());
  assert.ok(first.nativeQuote);
  assert.equal(first.nativeQuote.routeReference, RELAY_BNB_MONAD_ROUTE_REFERENCE);
  assert.equal(first.policyDigest, policy().digest);
  assert.equal(first.executionAdmitted, false); assert.equal(first.balanceEvidence, "not_checked");
  const providerId = (await fixture()).requestId as string;
  assert.equal(JSON.stringify(first).includes(providerId), false);
  const prepareEnvelope = await new ApnCore({ state, relayPrepare: service() }).execute(commandInput);
  assert.equal(prepareEnvelope.ok, true);
  assert.equal(JSON.stringify(prepareEnvelope).includes(providerId), false);
  assert.equal(JSON.stringify(await new ApnCore({ state }).execute({ command: "operation.status",
    operationId: first.operationId })).includes(providerId), false);
  assert.deepEqual(await service().prepareNative(commandInput), first);
  assert.equal(calls, 1);
  assert.deepEqual(await new OperationService(state).status(first.operationId), first);
  await assert.rejects(service().prepareNative({ ...input, minOutputAtomic: "41000000000000000000" }),
    { code: "APN_IDEMPOTENCY_CONFLICT" });
  assert.equal(calls, 1);
});

test("Monad prepare rejects fee ceiling and stale provider order before persistence", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
    nativeQuote: async quoteIntent => validateRelayNativeQuote(await fixture(), quoteIntent),
  });
  await assert.rejects(service.prepareNative({ ...input, maxDepositNetworkFeeWei: "1" }), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new OperationService(state).required(state.operationId(input.profile, input.idempotencyKey)),
    { code: "APN_OPERATION_NOT_FOUND" });
  const stale = new RelayUnsignedPrepareService(state, { now: () => new Date("2026-10-02T06:00:00.000Z") }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
    nativeQuote: async quoteIntent => validateRelayNativeQuote(await fixture(), { ...quoteIntent, nowSeconds: intent.nowSeconds }),
  });
  await assert.rejects(stale.prepareNative(input), { code: "APN_OPERATION_BLOCKED" });
});

test("buyer retires expired untouched Monad quote locally and idempotently", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); let quotes = 0;
  const prepare = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
    nativeQuote: async quoteIntent => { quotes++; return validateRelayNativeQuote(await fixture(), quoteIntent); },
  });
  const first = await prepare.prepareNative(input);
  const path = join(temp.root, "relay-unsigned-operations", first.profileHash, `${first.operationId}.json`);
  const bytes = await readFile(path);
  const retire = new RelayRetireService(state, { now: () => new Date("2026-10-02T06:00:00.000Z") }, {
    load: async () => { throw new Error("unexpected wallet secret read"); },
    create: async () => { throw new Error("unexpected wallet secret creation"); },
  });
  await assert.rejects(retire.retire({ profile: "default", operationId: first.operationId }),
    { code: "APN_OPERATION_BLOCKED" });
  const result = await retire.retire({ profile: input.profile, operationId: first.operationId });
  assert.equal(result.state, "retired"); assert.equal(result.terminal, true);
  assert.deepEqual(await retire.retire({ profile: input.profile, operationId: first.operationId }), result);
  assert.deepEqual(await prepare.prepareNative(input), result);
  assert.deepEqual(await readFile(path), bytes);
  assert.equal(quotes, 1);
});
