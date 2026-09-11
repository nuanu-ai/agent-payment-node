import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { SA_REASON_CODES, saClassify, saError } from "../../src/smart-account-gasless/reasons.js";
import { saRequest, saStateCounters, validateSmartAccountGaslessIntent } from "../../src/smart-account-gasless/schema.js";
import { saImmutable, saRequestHash } from "../../src/smart-account-gasless/operation-model.js";
import { hashObject } from "../../src/canonical.js";
import { saRegistry } from "../../src/smart-account-gasless/registry.js";
import { saPolicyHash } from "../../src/smart-account-gasless/integrity.js";
import { smartAccountEnvironment } from "../../src/metamask-smart-account-grant.js";
import { saTestIntent, SA_TEST_RECIPIENT } from "./smart-account-gasless-fixtures.js";

const rejected = (run: () => unknown, code: string): void => {
  assert.throws(run, error => error instanceof ApnError && error.code === code);
};
test("Smart Account gasless permits the canonical zero-fee atomic request", () => {
  assert.deepEqual(saRequest(saTestIntent().request), saTestIntent().request);
  assert.equal(saRequest({ ...saTestIntent().request, maxFeeAtomic: "10" }).maxFeeAtomic, "10");
});
test("Smart Account request validation rejects unadmitted rows and invalid atomic boundaries", () => {
  rejected(() => saRequest({ ...saTestIntent().request, chainId: 1 }), "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  for (const patch of [
    { grossAtomic: "0" }, { grossAtomic: "01" }, { grossAtomic: "-1" }, { grossAtomic: "1.5" },
    { grossAtomic: String(1n << 256n) }, { minReceivedAtomic: "0" }, { minReceivedAtomic: "10001" },
    { maxFeeAtomic: "-1" }, { maxFeeAtomic: String(1n << 256n) },
    { recipient: `0x${"0".repeat(40)}` }, { recipient: "0x1234" }, { surprise: true },
  ]) rejected(() => saRequest({ ...saTestIntent().request, ...patch }), "APN_INVALID_INPUT");
  assert.equal(saRequest({ ...saTestIntent().request, grossAtomic: String((1n << 256n) - 1n) }).grossAtomic,
    String((1n << 256n) - 1n));
});
test("Saved intent rejects secret or unknown fields even when every outer field looks valid", () => {
  const good = saTestIntent();
  assert.deepEqual(validateSmartAccountGaslessIntent(good), good);
  for (const mutate of [
    (x: any) => { x.binding.session_private_key = "secret-canary"; },
    (x: any) => { x.requirements.resource = { url: "seller" }; },
    (x: any) => { x.initialSnapshot.safeState.rawResponse = "secret-canary"; },
    (x: any) => { x.provider.authorization = "secret-canary"; },
  ]) { const x = structuredClone(good); mutate(x); rejected(() => validateSmartAccountGaslessIntent(x), "APN_STATE_CORRUPT"); }
});
test("Saved intent binds exact economics, profile/grant identity, period, clock and deployment", () => {
  const good = saTestIntent();
  for (const mutate of [
    (x: any) => { x.requirements.amount = "9999"; },
    (x: any) => { x.requirements.payTo = x.binding.ownerAddress; },
    (x: any) => { x.requirements.extra.facilitatorAddresses = [SA_TEST_RECIPIENT]; },
    (x: any) => { x.request.recipient = x.binding.ownerAddress; x.requirements.payTo = x.binding.ownerAddress; },
    (x: any) => { x.binding.profileHash = "0".repeat(64); },
    (x: any) => { x.binding.accountBindingHash = "0".repeat(64); },
    (x: any) => { x.binding.rootExpiresAtUnix = x.beforeUnix - 1; },
    (x: any) => { x.beforeUnix += 1; },
    (x: any) => { x.binding.periodTerms = "0x"; },
    (x: any) => { x.binding.permissionRevision = 0; },
    (x: any) => { x.binding.rootNonceAtomic = "1"; },
    (x: any) => { x.initialSnapshot.safeState.currentNonceAtomic = "1"; },
    (x: any) => { x.initialSnapshot.safeState.currentNonceAtomic = "00"; },
    (x: any) => { x.initialSnapshot.safeState.availableAtomic = "9999"; },
    (x: any) => { x.initialSnapshot.safeState.usdcBalanceAtomic = "9999"; },
    (x: any) => { x.initialSnapshot.safeState.protocolCodeHashes.manager = `0x${"0".repeat(64)}`; },
    (x: any) => { x.initialSnapshot.safeState.tokenImplementationAddress = SA_TEST_RECIPIENT; },
    (x: any) => { x.initialSnapshot.safeBlock.numberAtomic = "50000001"; },
    (x: any) => { x.policyHash = "0".repeat(64); },
  ]) { const x = structuredClone(good); mutate(x); rejected(() => validateSmartAccountGaslessIntent(x), "APN_STATE_CORRUPT"); }
  assert.equal(good.binding.profileRevision, 2);
  assert.equal(good.binding.permissionRevision, 1);
  assert.equal(good.binding.rootNonceAtomic, good.initialSnapshot.safeState.currentNonceAtomic);
});
test("Every protocol pin including root NonceEnforcer is bound independently", () => {
  const good = saTestIntent(), names = Object.keys(good.initialSnapshot.safeState.protocolCodeHashes);
  assert.equal(names.length, 9);
  assert(names.includes("nonce"));
  for (const name of names) {
    const changed = structuredClone(good);
    (changed.initialSnapshot.safeState.protocolCodeHashes as any)[name] = `0x${"0".repeat(64)}`;
    rejected(() => validateSmartAccountGaslessIntent(changed), "APN_STATE_CORRUPT");
  }
  const r = saRegistry(8453), sdk = smartAccountEnvironment();
  assert.equal(r.protocol.manager.address, sdk.DelegationManager.toLowerCase());
  assert.equal(r.protocol.nonce.address, sdk.caveatEnforcers.NonceEnforcer!.toLowerCase());
  assert.equal(r.protocol.delegate.address, sdk.implementations.EIP7702StatelessDeleGatorImpl!.toLowerCase());
});
test("The real pinned allowance SDK uses UINT256_MAX duration and cannot become a daily grant", () => {
  const good = saTestIntent();
  assert.equal(BigInt(`0x${good.binding.periodTerms.slice(106, 170)}`), (1n << 256n) - 1n);
  assert.deepEqual(validateSmartAccountGaslessIntent(good), good);
  const changed = structuredClone(good);
  (changed.binding as any).periodTerms = `${good.binding.periodTerms.slice(0, 106)}${86400n.toString(16).padStart(64, "0")}${good.binding.periodTerms.slice(170)}`;
  (changed as any).policyHash = saPolicyHash(changed.binding, changed.request);
  rejected(() => validateSmartAccountGaslessIntent(changed), "APN_STATE_CORRUPT");
});
test("All 24 public reasons use actual ErrorCode members and discard untrusted error text", async () => {
  const source = await readFile(new URL("../../../src/errors.ts", import.meta.url), "utf8");
  const actual = new Set([...source.matchAll(/\|\s*"(APN_[A-Z0-9_]+)"/gu)].map(x => x[1]));
  assert.equal(Object.keys(SA_REASON_CODES).length, 24);
  for (const [reason, code] of Object.entries(SA_REASON_CODES)) {
    assert(actual.has(code), `${reason}: ${code}`);
    const error = saError(reason as keyof typeof SA_REASON_CODES);
    assert.equal(error.code, code); assert.equal(error.details?.reason, reason);
  }
  const failure = saClassify(new Error("secret-canary"), "sa_gasless_provider_protocol");
  assert.deepEqual(failure, { code: "APN_PROVIDER_PROTOCOL", reason: "sa_gasless_provider_protocol" });
  assert(!JSON.stringify(failure).includes("secret-canary"));
});
test("The sign/exposure/dispatch markers cannot be erased or represented as before-effect failure", () => {
  const counters = (state: string, signingAttempts: unknown, exposureAttempts: unknown, submissionAttempts: unknown) =>
    ({ state, signingAttempts, exposureAttempts, submissionAttempts });
  for (const legal of [counters("awaiting_approval", 0, 0, 0), counters("material_pending", 1, 0, 0),
    counters("exposure_pending", 1, 1, 0), counters("dispatch_pending", 1, 1, 1),
    counters("unknown_finality", 1, 1, 0), counters("completed", 1, 1, 0),
    counters("failed_before_effect", 1, 0, 0)]) assert.deepEqual(saStateCounters(legal), legal);
  for (const illegal of [counters("material_pending", 0, 0, 0), counters("exposure_pending", 1, 0, 0),
    counters("dispatch_pending", 1, 1, 0), counters("failed_before_effect", 1, 1, 0),
    counters("awaiting_approval", 1, 0, 0), counters("completed", 1, 0, 0),
    counters("unknown_finality", 1, 1, 2), counters("unknown_finality", "1", 1, 0),
    counters("invented", 0, 0, 0)]) rejected(() => saStateCounters(illegal), "APN_STATE_CORRUPT");
});
test("The immutable operation and request domains distinguish changed input and profile identity", () => {
  const intent = saTestIntent(), identity = { profileHash: intent.binding.profileHash,
    operationId: "1".repeat(64), idempotencyHash: "2".repeat(64), requestHash: saRequestHash(intent.binding.profileHash, intent) };
  const original = hashObject(saImmutable({ ...identity, intent, createdAt: intent.preparedAt }));
  const changed = structuredClone(intent); (changed.request as any).grossAtomic = "10001";
  assert.notEqual(saRequestHash(identity.profileHash, changed), identity.requestHash);
  assert.notEqual(saRequestHash("3".repeat(64), intent), identity.requestHash);
  assert.notEqual(hashObject(saImmutable({ ...identity, intent: changed, createdAt: intent.preparedAt })), original);
  assert.equal(hashObject(saImmutable({ ...identity, intent, createdAt: intent.preparedAt })), original);
});
test("Static deployment admission has no executable wider-chain fallback", () => {
  const registry = saRegistry(8453);
  assert.equal(registry.token.decimals, 6);
  assert.equal(registry.facilitatorAddresses.length, 1);
  assert(Object.isFrozen(registry) && Object.isFrozen(registry.protocol));
  for (const chain of [1, 137, 143, 1329, 42161, 84532, 0, NaN]) {
    rejected(() => saRegistry(chain), "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  }
});
