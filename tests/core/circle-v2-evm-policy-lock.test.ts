import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { hashObject } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { CircleUsage, circleMechanism } from "../../src/circle-v2-evm/usage.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, circleRoute, type CircleDestinationChain } from "../../src/circle-v2-evm/catalog.js";
import type { CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function temporaryState() { const root = await realpath(await mkdtemp(join(tmpdir(), "circle-policy-lock-"))); return { root, cleanup: () => rm(root, { recursive: true, force: true }) }; }
const now = new Date("2026-10-09T01:00:00.000Z");
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(root: string, chain: CircleDestinationChain, expiresAt?: string | Readonly<Record<string, string>>, destinationProfile?: string) {
  const state = new StateStore(root), store = new AllowlistPolicyStore(root), route = circleRoute(chain, destinationProfile); await state.initialize();
  const op = { profile: "evm-live-buyer", profileHash: state.profileHash("evm-live-buyer"), destinationProfile: route.gasPayerProfile,
    destinationProfileHash: state.profileHash(route.gasPayerProfile), destinationChain: chain,
    sourceCustody: { walletAddress: CIRCLE_SOURCE_OWNER }, destinationCustody: { walletAddress: route.gasPayer }, policies: [], usage: [] } as unknown as CircleOperationV1;
  const heads = new Map<string, Awaited<ReturnType<AllowlistPolicyStore["appendDecision"]>>>();
  for (const profile of [...new Set([op.profile, op.destinationProfile])]) {
    const account = profile === op.profile ? CIRCLE_SOURCE_OWNER : route.gasPayer;
    const admissions = [{ chain: "eip155:42161", kind: "token" as const, identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge" as const, maximumPerTransferAtomic: "100000", dailyLimitAtomic: "1000000", mechanism: circleMechanism(chain) },
      { chain: "eip155:42161", kind: "native" as const, rail: "bridge" as const, maximumPerTransferAtomic: "75000000000000", dailyLimitAtomic: "1000000000000000", mechanism: circleMechanism(chain) },
      { chain: `eip155:${chain}`, kind: "native" as const, rail: "bridge" as const, maximumPerTransferAtomic: route.destinationNativeCap, dailyLimitAtomic: (BigInt(route.destinationNativeCap) * 10n).toString(), mechanism: circleMechanism(chain) }];
    const expiry = typeof expiresAt === "string" ? expiresAt : expiresAt?.[profile];
    const record = await store.stage({ profile, now, policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "circle-lock-fixture.1", accounts: { evm: account }, effectiveAt: new Date(now.getTime() - 1000).toISOString(), ...(expiry === undefined ? {} : { expiresAt: expiry }), admissions } });
    const head = await store.appendDecision(profile, null, { status: "active", revision: record.revision, stagedRecordDigest: record.recordDigest,
      policyDigest: record.registry.policyDigest, registry: record.registry, approvalFingerprint: hashObject(profile), decidedAt: now.toISOString() }); heads.set(profile, head);
  }
  return { state, store, op, heads, usage: new CircleUsage(state, () => now.getTime()) };
}
for (const chain of [143, 1329] as const) test(`policy scope ${chain}: distinct/same profiles deduplicate; reads do not reacquire held locks`, { timeout: 10000 }, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, chain);
  assert.notEqual(f.state.profileHash(f.op.profile), allowlistProfileHash(f.op.profile));
  await assert.rejects(f.usage.policies(f.op), /owner_policy_lock_required/u);
  const profiles = [f.op.profile, f.op.destinationProfile, f.op.profile];
  const policies = await f.usage.withPolicyLocks(profiles, () => f.usage.policies(f.op));
  assert.equal(policies.length, new Set(profiles).size); for (const p of policies) assert.equal(p.activationDigest, f.heads.get(p.profile)!.entryDigest);
  await assert.rejects(f.usage.withPolicyLocks(profiles, () => f.usage.withPolicyLocks(profiles, async () => {})), /policy_lock_scope_reentry/u);
});
for (const decision of ["revoked", "active"] as const) test(`${decision} waits for the entire two-owner execution policy scope`, { timeout: 10000 }, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, 143), entered = deferred(), release = deferred();
  let completed = false;
  const reader = f.usage.withPolicyLocks([f.op.destinationProfile, f.op.profile], async () => { await f.usage.policies(f.op); entered.resolve(); await release.promise; await f.usage.policies(f.op); });
  await entered.promise; const head = f.heads.get(f.op.destinationProfile)!;
  const writer = f.store.appendDecision(f.op.destinationProfile, head.entryDigest, { status: decision, revision: head.revision, stagedRecordDigest: head.stagedRecordDigest,
    policyDigest: head.policyDigest, ...(decision === "active" ? { registry: head.registry! } : {}), approvalFingerprint: hashObject(decision), decidedAt: now.toISOString() }).then(() => { completed = true; });
  await pause(25); assert.equal(completed, false); release.resolve(); await Promise.all([reader, writer]); assert.equal(completed, true);
});
test("changed activation before acquisition refuses the frozen grant; absence cannot grant legacy dispatch", { timeout: 10000 }, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, 143);
  const policies = await f.usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], () => f.usage.policies(f.op));
  const head = f.heads.get(f.op.profile)!;
  await f.store.appendDecision(f.op.profile, head.entryDigest, { status: "active", revision: head.revision, stagedRecordDigest: head.stagedRecordDigest,
    policyDigest: head.policyDigest, registry: head.registry!, approvalFingerprint: hashObject("new-grant"), decidedAt: now.toISOString() });
  await assert.rejects(f.usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], () => f.usage.confirm({ ...f.op, policies })), /owner_policy_changed/u);
  const legacy = policies.map(({ activationDigest: _digest, ...p }) => p);
  await assert.rejects(f.usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], () => f.usage.confirm({ ...f.op, policies: legacy })), /owner_policy_changed/u);
});
test("opposite profile ordering shares canonical locks without deadlock or concurrent scopes", { timeout: 10000 }, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, 143), other = new CircleUsage(f.state, () => now.getTime());
  let active = 0, maximum = 0;
  const read = (usage: CircleUsage, profiles: string[]) => usage.withPolicyLocks(profiles, async () => { maximum = Math.max(maximum, ++active); await usage.policies(f.op); await pause(10); --active; });
  await Promise.all([read(f.usage, [f.op.profile, f.op.destinationProfile]), read(other, [f.op.destinationProfile, f.op.profile])]); assert.equal(maximum, 1);
});

test("policy expiration while waiting for locks refuses before any financial continuation", { timeout: 10000 }, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const expires = now.getTime() + 1000, f = await fixture(temporary.root, 143, new Date(expires).toISOString());
  let clock = now.getTime(), effects = 0; const usage = new CircleUsage(f.state, () => clock), entered = deferred(), release = deferred();
  const blocker = f.state.withLocks([`profile:${allowlistProfileHash(f.op.profile)}`], async () => { entered.resolve(); await release.promise; }); await entered.promise;
  const waiting = usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], async () => { await usage.policies(f.op); effects++; });
  const refused = assert.rejects(waiting, /active allowlist policy has expired/u); await pause(25); clock = expires; release.resolve(); await Promise.all([blocker, refused]); assert.equal(effects, 0);
});
test("async work inherited from an ended scope cannot perform policy reads", { timeout: 10000 }, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, 143), release = deferred(); let late!: Promise<unknown>;
  await f.usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], async () => { late = release.promise.then(() => f.usage.policies(f.op)); });
  const refused = assert.rejects(late, /owner_policy_lock_required/u); release.resolve(); await refused;
});
test("held USDC and 75T source capacity are re-admitted without counting the same reservation twice", { timeout: 10000 }, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, 143);
  await f.usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], async () => {
    const policies = await f.usage.policies(f.op), prepared = { ...f.op, operationId: "a".repeat(64), policies };
    const usage = await f.usage.reserve(prepared), held = { ...prepared, usage };
    assert.equal(usage.length, 5); assert.equal(usage[0]!.amountAtomic, "40100");
    assert.equal(usage.slice(1, 4).reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n), 75000000000000n);
    await f.usage.confirm(held);
  });
});

test("seller Sei uses the exact destination activation and native policy hold", { timeout: 10000 }, async t => {
 const temporary=await temporaryState();t.after(temporary.cleanup);const f=await fixture(temporary.root,1329,undefined,"evm-live-seller");
 await f.usage.withPolicyLocks([f.op.profile,f.op.destinationProfile],async()=>{const policies=await f.usage.policies(f.op); assert.equal(policies.length,2);assert.ok(policies.some(p=>p.profile==="evm-live-seller"));const prepared={...f.op,operationId:"b".repeat(64),policies};const usage=await f.usage.reserve(prepared);assert.equal(usage[4]!.account,circleRoute(1329,"evm-live-seller").gasPayer);await f.usage.confirm({...prepared,usage});});
});

test("authorization deadline is the earliest exact locked source/destination policy window", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const sourceEnd = new Date(now.getTime() + 2000).toISOString(), destinationEnd = new Date(now.getTime() + 1).toISOString();
  const f = await fixture(temporary.root, 143, { "evm-live-buyer": sourceEnd, default: destinationEnd });
  await f.usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], async () => {
    const op = { ...f.op, policies: await f.usage.policies(f.op) }; assert.equal(await f.usage.authorizationDeadline(op), destinationEnd);
    await assert.rejects(f.usage.authorizationDeadline({ ...op, policies: op.policies.map(({ activationDigest: _digest, ...p }) => p) }), /owner_policy_changed/);
  });
  await assert.rejects(f.usage.authorizationDeadline(f.op), /owner_policy_lock_required/);
});
test("an owner registry without an end has no policy deadline and does not mint authority outside its scope", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, 143);
  await f.usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], async () => { const op = { ...f.op, policies: await f.usage.policies(f.op) }; assert.equal(await f.usage.authorizationDeadline(op), null); });
});

test("expired owner policy can release only the existing proven-unspent reservation outcome", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const expires = now.getTime() + 1, f = await fixture(temporary.root, 143, new Date(expires).toISOString());
  const held = await f.usage.withPolicyLocks([f.op.profile, f.op.destinationProfile], async () => {
    const prepared = { ...f.op, operationId: "c".repeat(64), effects: [], source: null, destination: null, policies: await f.usage.policies(f.op) }; return { ...prepared, usage: await f.usage.reserve(prepared) };
  });
  const expired = new CircleUsage(f.state, () => expires);
  await expired.withPolicyLocks([held.profile, held.destinationProfile], async () => {
    await assert.rejects(expired.authorizationDeadline(held), /active allowlist policy has expired/);
    const released = await expired.follow(held, "failed_before_effect");
    assert.equal(released.length, 5); for (const row of released) { assert.equal(row.state, "failed_before_effect"); assert.equal(row.consumedAtomic, undefined); assert.equal((await new AssetUsageLedger(temporary.root).usageReadOnly(row, new Date(expires))).amountAtomic, "0"); }
  });
});
