import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnCore } from "../../src/core.js";
import { OperationService } from "../../src/operation-service.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { RelayRetireService } from "../../src/relay/retire.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { RELAY_BNB_POLYGON_ROUTE_REFERENCE, RELAY_BNB_SOURCE, RELAY_POLYGON_RECIPIENT,
  validateRelayNativeQuote } from "../../src/relay/native-quote.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const instant = new Date(1790909529 * 1000);
const input = { profile: "evm-live-buyer", recipient: RELAY_POLYGON_RECIPIENT, amountAtomic: "1500000000000000",
  minOutputAtomic: "9000000000000000000", maxDepositNetworkFeeWei: "30000000000000",
  idempotencyKey: "relay-bnb-pol-0001" };
const fixture = async (): Promise<unknown> => JSON.parse(await readFile("tests/core/relay-fixtures/bnb-native-polygon-native-quote-20260925.json", "utf8"));
function policy(reference = RELAY_BNB_POLYGON_ROUTE_REFERENCE, kind: "native" | "token" = "native") {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "relay-native.test.1",
    publishedAt: "2026-09-30T00:00:00.000Z", effectiveDate: "2026-09-30", effectiveAt: "2026-09-30T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:56", family: "evm", name: "BNB Smart Chain",
      assets: [{ kind, identifier: kind === "native" ? null : "0x55d398326f99059fF775485246999027B3197955",
        symbol: kind === "native" ? "BNB" : "USDT", decimals: 18,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "2000000000000000", dailyLimitAtomic: "3000000000000000" } },
        mechanismPins: { bridge: { provider: "relay", reference } } }] }] });
  return { profile: input.profile, registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: RELAY_BNB_SOURCE }, activationDigest: "a".repeat(64), activatedAt: instant.toISOString() };
}

test("BNB native prepare is policy bound, durable, unsigned and replayed without another quote", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  let calls = 0;
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
    nativeQuote: async intent => { calls++; return validateRelayNativeQuote(await fixture(), intent); },
  });
  assert.deepEqual(bindArgv(["relay", "native", "prepare", "--profile", input.profile, "--recipient", input.recipient,
    "--amount-atomic", input.amountAtomic, "--min-output-atomic", input.minOutputAtomic,
    "--max-deposit-network-fee-wei", input.maxDepositNetworkFeeWei, "--idempotency-key", input.idempotencyKey]).request,
    { command: "relay.native.prepare", ...input });
  const commandInput = { command: "relay.native.prepare" as const, ...input };
  const first = await service.prepareNative(commandInput);
  assert.equal(first.sourceChainId, 56); assert.equal(first.destinationChainId, 137);
  assert.equal(first.quote, undefined); assert.ok(first.nativeQuote);
  assert.equal(first.executionAdmitted, false); assert.equal(first.balanceEvidence, "not_checked");
  assert.equal(first.allowanceEvidence, "not_checked"); assert.equal(first.statusObservable, true);
  assert.equal(first.policyDigest, policy().digest);
  assert.equal(first.nativeQuote.deposit.value, input.amountAtomic);
  const providerId = (await fixture() as any).requestId as string;
  assert.equal(first.statusObservable, true);
  assert.equal(JSON.stringify(first).includes(providerId), false);
  const prepareEnvelope = await new ApnCore({ state, relayPrepare: service }).execute(commandInput);
  assert.equal(prepareEnvelope.ok, true);
  assert.equal(JSON.stringify(prepareEnvelope).includes(providerId), false);
  assert.equal(JSON.stringify(await new ApnCore({ state }).execute({ command: "operation.status",
    operationId: first.operationId })).includes(providerId), false);
  assert.deepEqual(await service.prepareNative(commandInput), first); assert.equal(calls, 1);
  assert.deepEqual(await new OperationService(new StateStore(temp.root)).status(first.operationId), first);
  await assert.rejects(service.prepareNative({ ...input, amountAtomic: "1500000000000001" }),
    { code: "APN_IDEMPOTENCY_CONFLICT" });
  assert.equal(calls, 1);
});

test("BNB native prepare refuses missing native asset, route pin, wrong owner and fee before persistence", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  let calls = 0;
  const service = (active: ReturnType<typeof policy> | null) => new RelayUnsignedPrepareService(state,
    { now: () => instant }, undefined, { activePolicy: async () => active,
      publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
      nativeQuote: async intent => { calls++; return validateRelayNativeQuote(await fixture(), intent); } });
  await assert.rejects(service(null).prepareNative(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(service(policy("wrong-route")).prepareNative(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(service(policy(RELAY_BNB_POLYGON_ROUTE_REFERENCE, "token")).prepareNative(input));
  await assert.rejects(service({ ...policy(), accounts: { evm: RELAY_POLYGON_RECIPIENT } }).prepareNative(input),
    { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(service(policy()).prepareNative({ ...input, recipient: "0x1111111111111111111111111111111111111111" }),
    { code: "APN_INVALID_INPUT" });
  assert.equal(calls, 0);
  await assert.rejects(service(policy()).prepareNative({ ...input, maxDepositNetworkFeeWei: "1" }),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 1);
  await assert.rejects(new OperationService(state).required(state.operationId(input.profile, input.idempotencyKey)),
    { code: "APN_OPERATION_NOT_FOUND" });
});

test("buyer BNB native quote retires locally, keeps its saved quote and admits a fresh key", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  let quotes = 0;
  const prepare = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
    nativeQuote: async intent => { quotes++; return validateRelayNativeQuote(await fixture(), intent); },
  });
  const first = await prepare.prepareNative(input);
  const savedPath = join(temp.root, "relay-unsigned-operations", first.profileHash, `${first.operationId}.json`);
  const savedBytes = await readFile(savedPath);
  const next = { ...input, idempotencyKey: "relay-bnb-pol-0002" };
  await assert.rejects(prepare.prepareNative(next), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(quotes, 1);
  assert.deepEqual(bindArgv(["relay", "retire", "--profile", input.profile, "--operation", first.operationId]).request,
    { command: "relay.retire", profile: input.profile, operationId: first.operationId });
  const retire = new RelayRetireService(state, { now: () => instant }, {
    load: async () => { throw new Error("unexpected wallet secret read"); },
    create: async () => { throw new Error("unexpected wallet secret creation"); },
  });
  const result = await retire.retire({ profile: input.profile, operationId: first.operationId });
  assert.equal(result.state, "retired"); assert.equal(result.terminal, true);
  assert.deepEqual(await retire.retire({ profile: input.profile, operationId: first.operationId }), result);
  assert.deepEqual(await new OperationService(state).status(first.operationId), result);
  assert.deepEqual(await readFile(savedPath), savedBytes);
  assert.deepEqual(await prepare.prepareNative(input), result);
  const fresh = await prepare.prepareNative(next);
  assert.equal(fresh.state, "prepared"); assert.equal(quotes, 2);
});

test("buyer Relay retirement rejects wrong profile and an existing native usage reservation", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const prepare = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
    nativeQuote: async intent => validateRelayNativeQuote(await fixture(), intent),
  });
  const first = await prepare.prepareNative(input);
  const retire = new RelayRetireService(state, { now: () => instant });
  await assert.rejects(retire.retire({ profile: "default", operationId: first.operationId }),
    { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(retire.retire({ profile: "other", operationId: first.operationId }),
    { code: "APN_INVALID_INPUT" });
  await new AssetUsageLedger(temp.root).reserve({ account: RELAY_BNB_SOURCE, chain: "eip155:56",
    asset: { kind: "native", identifier: null }, registry: policy().registry, rail: "bridge",
    amountAtomic: input.amountAtomic, idempotencyKey: input.idempotencyKey, now: instant });
  await assert.rejects(retire.retire({ profile: input.profile, operationId: first.operationId }),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await new OperationService(state).status(first.operationId) as { state: string }).state, "prepared");
});

test("buyer Relay retirement fails closed on changed saved quote or policy binding", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const first = await new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => RELAY_BNB_SOURCE, dailyUsage: async () => "0",
    nativeQuote: async intent => validateRelayNativeQuote(await fixture(), intent),
  }).prepareNative(input);
  const path = join(temp.root, "relay-unsigned-operations", first.profileHash, `${first.operationId}.json`);
  const original = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...original, policyDigest: "b".repeat(64) }));
  await assert.rejects(new RelayRetireService(state, { now: () => instant }).retire({
    profile: input.profile, operationId: first.operationId }), { code: "APN_STATE_CORRUPT" });
  await writeFile(path, JSON.stringify({ ...original, nativeQuote: { ...original.nativeQuote, recipient: RELAY_BNB_SOURCE } }));
  await assert.rejects(new RelayRetireService(state, { now: () => instant }).retire({
    profile: input.profile, operationId: first.operationId }), { code: "APN_STATE_CORRUPT" });
});
