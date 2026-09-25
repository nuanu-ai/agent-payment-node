import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { bindArgv } from "../../src/command-binder.js";
import { OperationService } from "../../src/operation-service.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
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
  const first = await service.prepareNative(input);
  assert.equal(first.sourceChainId, 56); assert.equal(first.destinationChainId, 137);
  assert.equal(first.quote, undefined); assert.ok(first.nativeQuote);
  assert.equal(first.executionAdmitted, false); assert.equal(first.balanceEvidence, "not_checked");
  assert.equal(first.allowanceEvidence, "not_checked"); assert.equal(first.statusObservable, true);
  assert.equal(first.policyDigest, policy().digest);
  assert.equal(first.nativeQuote.deposit.value, input.amountAtomic);
  assert.deepEqual(await service.prepareNative(input), first); assert.equal(calls, 1);
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
  await assert.rejects(service(policy()).prepareNative({ ...input, recipient: RELAY_BNB_SOURCE }),
    { code: "APN_INVALID_INPUT" });
  assert.equal(calls, 0);
  await assert.rejects(service(policy()).prepareNative({ ...input, maxDepositNetworkFeeWei: "1" }),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 1);
  await assert.rejects(new OperationService(state).required(state.operationId(input.profile, input.idempotencyKey)),
    { code: "APN_OPERATION_NOT_FOUND" });
});
