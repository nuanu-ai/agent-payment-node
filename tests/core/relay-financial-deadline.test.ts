import assert from "node:assert/strict";
import { readFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { RelayNativeAuthority } from "../../src/relay/native-authority.js";
import { RelayNativeSourceJournalRepository } from "../../src/relay/native-source.js";
import { RelayUnsignedOperationRepository, freezeRelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { RELAY_BASE_SOURCE, RELAY_POLYGON_RECIPIENT, validateRelayNativeQuote, verifySavedRelayNativeQuote } from "../../src/relay/native-quote.js";
import { StateStore } from "../../src/state.js";
async function temporaryState() { const root = await mkdtemp(join(await realpath(tmpdir()), "apn-relay-window-test-")); return { root, cleanup: async () => rm(root, { recursive: true, force: true }) }; }
const start = Date.parse("2026-10-09T06:20:40.000Z"), end = start + 2 * 60 * 60 * 1000;
const raw = async () => JSON.parse(await readFile("tests/core/relay-fixtures/relay-base-mega-usdm-seven-day-quote-20261009.json", "utf8"));
function policy(expiry = end) {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "relay-window.test.1",
    publishedAt: "2026-10-09T00:00:00.000Z", effectiveDate: "2026-10-09", effectiveAt: "2026-10-09T00:00:00.000Z", expiresAt: new Date(expiry).toISOString(),
    chains: [{ chain: "eip155:8453", family: "evm", name: "Base", assets: [{ kind: "native", identifier: null, symbol: "ETH", decimals: 18,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false }, railCaps: { bridge: { maximumPerTransferAtomic: "50000000000000", dailyLimitAtomic: "110000000000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: "base-native-mega-usdm-default-v1" } } }] }] });
  return { profile: "evm-live-seller", registry, digest: registry.policyDigest, revision: 7, accounts: { evm: RELAY_BASE_SOURCE }, activationDigest: "a".repeat(64), activatedAt: new Date(start).toISOString() };
}
const input = { profile: "evm-live-seller", recipient: RELAY_POLYGON_RECIPIENT, amountAtomic: "50000000000000", minOutputAtomic: "90000000000000000",
  maxDepositNetworkFeeWei: "1000000000000", idempotencyKey: "relay-window-0001" };
async function setup(t: TestContext, options: { expiry?: number; quoteEnd?: number; afterQuote?: () => void } = {}) {
  const temp = await temporaryState(); t.after(temp.cleanup); const state = new StateStore(temp.root); let at = start;
  const active = policy(options.expiry); const q = await validateRelayNativeQuote(await raw(), { payer: RELAY_BASE_SOURCE, recipient: RELAY_POLYGON_RECIPIENT,
    amountAtomic: input.amountAtomic, minimumOutputWei: input.minOutputAtomic, nowSeconds: start / 1000 });
  const service = new RelayUnsignedPrepareService(state, { now: () => new Date(at) }, undefined, { activePolicy: async () => active,
    publicAccount: async () => RELAY_BASE_SOURCE, dailyUsage: async () => "10000000000000", nativeQuote: async () => {
      options.afterQuote?.(); if (options.quoteEnd !== undefined) at = options.quoteEnd; return q;
    } });
  return { temp, state, active, q, service, setNow: (value: number) => { at = value; }, clock: { now: () => new Date(at) } };
}
test("actual seven-day signed order prepares under captured two-hour Base policy without rewriting provider deadline", async t => {
  const f = await setup(t), before = hashObject(f.q); const prepared = await f.service.prepareNative(input);
  const saved = (await new RelayUnsignedOperationRepository(f.temp.root).findOperation(prepared.operationId))!;
  assert.equal(saved.deadline, new Date(f.q.deadline * 1000).toISOString()); assert.equal(hashObject(saved.nativeQuote), before);
  assert(f.q.deadline * 1000 > end); assert.equal(saved.policyRevision, 7); assert.equal(saved.policyActivationDigest, f.active.activationDigest);
  const controller = new AbortController(), grant = new RelayNativeAuthority(saved, f.active, f.clock, controller.signal);
  assert.equal(grant.deadline, new Date(end).toISOString()); grant.assert(); f.setNow(end); assert.throws(() => grant.assert());
  const successor = { ...policy(end + 2 * 60 * 60 * 1000), revision: 8, activationDigest: "b".repeat(64) };
  assert.throws(() => grant.assert(successor)); assert.throws(() => new RelayNativeAuthority(saved, successor, f.clock, controller.signal));
  const store = new RelayNativeSourceJournalRepository(f.temp.root); await store.claimSigning(saved, 0n); await assert.rejects(store.claimSigning(saved, 0n));
  await store.claimBroadcast(saved, "0x0102"); await assert.rejects(store.claimBroadcast(saved, "0x0102"));
  const { integrityHash: _hash, ...fields } = saved; assert.throws(() => freezeRelayUnsignedOperation({ ...fields, deadline: new Date(end).toISOString() }));
  const changed = { ...f.q, deadline: f.q.deadline + 1 }, { quoteDigest: _digest, ...body } = changed;
  await assert.rejects(verifySavedRelayNativeQuote({ ...changed, quoteDigest: hashObject(body) }));
});
for (const failure of ["expired", "expiry-during-quote", "provider-margin", "activation-during-quote"] as const) test(`Base prepare refuses ${failure} before a journal or effect`, async t => {
  const f = await setup(t, failure === "expired" ? { expiry: start } : failure === "expiry-during-quote" ? { quoteEnd: end } :
    failure === "provider-margin" ? { expiry: Date.parse("2026-10-17T00:00:00.000Z") } : {});
  if (failure === "provider-margin") f.setNow(f.q.deadline * 1000 - 59_999);
  if (failure === "activation-during-quote") Object.assign(f.active, { activationDigest: "b".repeat(64) });
  // The second read returns a different activation instead of mutating the captured object.
  if (failure === "activation-during-quote") {
    let reads = 0; (f.service as any).ports.activePolicy = async () => ({ ...f.active, activationDigest: (++reads === 1 ? "a" : "b").repeat(64) });
  }
  await assert.rejects(f.service.prepareNative(input)); assert.equal((await new RelayUnsignedOperationRepository(f.temp.root).listAllOperations()).length, 0);
});
