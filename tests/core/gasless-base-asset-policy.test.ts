import assert from "node:assert/strict";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { baseLocalGaslessMechanism } from "../../src/gasless/asset-policy.js";
import { GaslessExecution } from "../../src/gasless/execution.js";
import { validateGaslessIntent } from "../../src/gasless/intent-validation.js";
import { newGaslessOperation, transitionGasless } from "../../src/gasless/transitions.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { gaslessEnvelopeBinding } from "../../src/gasless/wire.js";
import { gaslessFixture, GASLESS_TEST_RECIPIENT, testWord } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const now = new Date("2026-09-18T02:00:00.000Z");
const token = gaslessDeployment(8453).token;
const account = { chain: "eip155:8453", asset: { kind: "token" as const, identifier: token } };

async function activate(root: string, profile: string, owner: string, options: {
  per?: string; daily?: string; pin?: { provider: string; reference: string };
} = {}) {
  const store = new AllowlistPolicyStore(root), before = await store.read(profile);
  const head = before.entries.at(-1), latest = before.records.at(-1);
  const record = await store.stage({ profile, now, ...(latest === undefined ? {} : { expectedRevision: latest.revision }),
    policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `base-gasless.${before.records.length + 1}`,
      accounts: { evm: owner }, effectiveAt: new Date(now.getTime() - 1_000).toISOString(),
      admissions: [{ chain: "eip155:8453", kind: "token", identifier: token, rail: "gasless",
        maximumPerTransferAtomic: options.per ?? "10000000", dailyLimitAtomic: options.daily ?? "20000000",
        mechanism: options.pin ?? baseLocalGaslessMechanism() }] } });
  await store.appendDecision(profile, head?.entryDigest ?? null, { status: "active", revision: record.revision,
    stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest,
    registry: record.registry, approvalFingerprint: hashObject(`base-gasless-${record.revision}`), decidedAt: now.toISOString() });
  return { store, record };
}

test("Base local gasless prepare requires the exact active account, token rail and canonical paymaster pin before RPC", async t => {
  for (const bad of ["missing", "account", "pin", "per_cap"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, 8453, { now, activatePolicy: false });
    if (bad !== "missing") await activate(temporary.root, s.profile,
      bad === "account" ? GASLESS_TEST_RECIPIENT : s.account.address,
      bad === "pin" ? { pin: { provider: "local", reference: "eip155:8453:0x0000000000000000000000000000000000000001" } }
        : bad === "per_cap" ? { per: "9999999" } : {});
    const result = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
      request: s.request, idempotencyKey: `denied-${bad}` });
    assert.equal(result.ok, false, bad);
    assert.equal(s.rpc.calls.length, 0, bad);
    assert.equal((await s.core.gasless.records.listAllOperations()).length, 0, bad);
  }
  assert.deepEqual(baseLocalGaslessMechanism(), {
    provider: "local", reference: `eip155:8453:${gaslessDeployment(8453).paymaster}` });
});

test("Base policy binding and combined daily cap are durable across prepare and approval", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now, activatePolicy: false });
  const { record: policy } = await activate(temporary.root, s.profile, s.account.address);
  const { id, operation } = await s.prepare();
  assert.equal(operation.intent.allowlist?.policyDigest, policy.registry.policyDigest);
  assert.equal(operation.intent.allowlist?.policyRevision, policy.revision);
  assert.deepEqual(operation.intent.allowlist?.mechanism, baseLocalGaslessMechanism());
  const usage = new AssetUsageLedger(temporary.root), identity = { ...account, account: s.account.address };
  const before = await usage.load(identity, operation.intent.allowlist!.reservationId);
  assert.equal(before, null, "prepare does not reserve until the owner approves");
  const approval = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(approval.ok, true, approval.error?.message);
  const submitted = await s.record(id);
  assert.equal(submitted.userOperation.submissionAttempts, 1);
  assert.equal(s.rpc.sends.length, 1);
  const lease = await usage.load(identity, submitted.intent.allowlist!.reservationId);
  assert.equal(lease?.state, "submitted");
  assert.equal(lease?.amountAtomic, s.request.grossAtomic);
  const again = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(again.ok, true); assert.equal(s.rpc.sends.length, 1);
});

test("forged durable mechanism and account fail even when their envelope hash is recomputed", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now });
  const { operation } = await s.prepare();
  for (const change of [
    { allowlist: { ...operation.intent.allowlist!, mechanism: { provider: "local" as const,
      reference: "eip155:8453:0x0000000000000000000000000000000000000001" } } },
    { owner: { ...operation.intent.owner, address: GASLESS_TEST_RECIPIENT } },
  ]) {
    const { unsignedEnvelopeHash: _old, ...body } = { ...operation.intent, ...change };
    const forged = { ...body, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(body)) };
    assert.throws(() => validateGaslessIntent(forged), { code: "APN_STATE_CORRUPT" });
  }
});

test("a crash after reservation but before the signing marker reuses one lease; status repairs a missed release", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now });
  const { id, operation } = await s.prepare();
  const usage = new AssetUsageLedger(temporary.root), identity = { ...account, account: s.account.address };
  await s.state.withLocks([`profile:${operation.profileHash}`, `operation:${id}`], async () => {
    await s.state.withLocks([`profile:${allowlistProfileHash(s.profile)}`], async () => {
      await s.core.gasless.policy.reserve(operation);
    });
  });
  assert.equal((await usage.load(identity, operation.intent.allowlist!.reservationId))?.state, "reserved");
  assert.equal((await s.record(id)).bootstrap.signingAttempts, 0);
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await usage.load(identity, operation.intent.allowlist!.reservationId))?.state, "submitted");
  assert.equal(s.rpc.sends.length, 1);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);

  const second = await s.prepare("lease-release-after-crash");
  await s.state.withLocks([`profile:${second.operation.profileHash}`, `operation:${second.id}`], async () => {
    await s.state.withLocks([`profile:${allowlistProfileHash(s.profile)}`], async () => {
      await s.core.gasless.policy.reserve(second.operation);
    });
  });
  const failed = transitionGasless(second.operation, { state: "failed_before_effect", failure: "gasless_approval_rejected" }, now.toISOString());
  await s.core.gasless.records.persist(failed); // Simulates a crash before the service's lease reconciliation.
  assert.equal((await usage.load(identity, failed.intent.allowlist!.reservationId))?.state, "reserved");
  assert.equal((await s.core.execute({ command: "operation.status", operationId: second.id })).ok, true);
  assert.equal((await usage.load(identity, failed.intent.allowlist!.reservationId))?.state, "failed_before_effect");
});

test("daily usage and changed activation block before a first signature, then release an unused lease", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now, activatePolicy: false });
  const { record } = await activate(temporary.root, s.profile, s.account.address, { daily: "10000000" });
  const usage = new AssetUsageLedger(temporary.root);
  await usage.reserve({ ...account, account: s.account.address, registry: record.registry, rail: "gasless",
    mechanism: baseLocalGaslessMechanism(), amountAtomic: "1", idempotencyKey: "other-operation", now });
  const denied = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
    request: s.request, idempotencyKey: "daily-cap-denied" });
  assert.equal(denied.ok, false); assert.equal(s.rpc.calls.length, 0);

  // A wider replacement permits preparation; revocation before approval must still stop before custody.
  await activate(temporary.root, s.profile, s.account.address, { daily: "20000000" });
  const { id, operation } = await s.prepare("policy-revocation-before-signature");
  const store = new AllowlistPolicyStore(temporary.root), state = await store.read(s.profile), head = state.entries.at(-1)!;
  await store.appendDecision(s.profile, head.entryDigest, { status: "revoked", revision: head.revision,
    stagedRecordDigest: head.stagedRecordDigest, policyDigest: head.policyDigest,
    approvalFingerprint: hashObject("revoke-base-gasless"), decidedAt: now.toISOString() });
  const result = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const stopped = await s.record(id);
  assert.equal(stopped.state, "failed_before_effect");
  assert.equal(stopped.bootstrap.signingAttempts, 0);
  assert.equal(s.rpc.sends.length, 0);
  assert.equal(await usage.load({ ...account, account: s.account.address }, operation.intent.allowlist!.reservationId), null);
});

test("revocation after the durable send marker keeps saved-hash observation and never resends", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now, activatePolicy: false });
  const { store } = await activate(temporary.root, s.profile, s.account.address);
  const { id } = await s.prepare();
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const head = (await store.read(s.profile)).entries.at(-1)!;
  await store.appendDecision(s.profile, head.entryDigest, { status: "revoked", revision: head.revision,
    stagedRecordDigest: head.stagedRecordDigest, policyDigest: head.policyDigest,
    approvalFingerprint: hashObject("post-send-revoke"), decidedAt: now.toISOString() });
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  assert.equal((await s.record(id)).state, "completed");
  assert.equal(s.rpc.sends.length, 1);
  const lease = await new AssetUsageLedger(temporary.root).load({ ...account, account: s.account.address },
    (await s.record(id)).intent.allowlist!.reservationId);
  assert.equal(lease?.state, "finalized");
});

test("safe reverted transfer releases gross daily usage after allowance cleanup while retaining its actual fee", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now, activatePolicy: false });
  await activate(temporary.root, s.profile, s.account.address, { daily: s.request.grossAtomic });
  const { id } = await s.prepare("reverted-gross-usage");
  s.rpc.success = false;
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const usage = new AssetUsageLedger(temporary.root), identity = { ...account, account: s.account.address };
  assert.equal((await usage.usage(identity, now)).amountAtomic, s.request.grossAtomic);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal((await s.record(id)).state, "failed_effects_pending");
  assert.equal((await usage.usage(identity, now)).amountAtomic, s.request.grossAtomic);
  s.rpc.safeAllowance = "0";
  s.rpc.safeNumber = "103";
  s.now.setTime(s.now.getTime() + 360000);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const final = await s.record(id);
  assert.equal(final.state, "failed_confirmed_revert");
  assert.equal(final.settlement?.accounting.deliveredAtomic, "0");
  assert.ok(BigInt(final.settlement!.accounting.feeAtomic) > 0n);
  const lease = await usage.load(identity, final.intent.allowlist!.reservationId);
  assert.equal(lease?.state, "failed_confirmed_revert");
  assert.equal(lease?.outcomeDigest, final.integrityHash);
  assert.equal((await usage.usage(identity, s.now)).amountAtomic, "0");
  assert.equal((await s.prepare("after-reverted-gross-usage")).operation.state, "awaiting_approval");
  assert.equal(s.rpc.sends.length, 1);
});

test("safe bootstrap permission invalidation releases an unsubmitted payment without replay", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now, activatePolicy: false });
  await activate(temporary.root, s.profile, s.account.address, { daily: s.request.grossAtomic });
  const { id } = await s.prepare("unsubmitted-invalidation");
  s.rpc.estimateFails = true;
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const before = await s.record(id), i = before.intent.initialSnapshot;
  assert.equal(before.userOperation.submissionAttempts, 0);
  assert.equal(before.bootstrap.disclosureAttempts, 1);
  const usage = new AssetUsageLedger(temporary.root), identity = { ...account, account: s.account.address };
  assert.equal((await usage.usage(identity, now)).amountAtomic, s.request.grossAtomic);
  const nonce = (BigInt(i.eoaNonceAtomic) + 1n).toString();
  const accountState = { owner: i.owner, balanceAtomic: i.balanceAtomic, nativeBalanceWei: i.nativeBalanceWei,
    allowanceAtomic: "0", permitNonceAtomic: (BigInt(i.permitNonceAtomic) + 1n).toString(),
    entryPointNonceAtomic: i.entryPointNonceAtomic, eoaNonceAtomic: nonce, pendingEoaNonceAtomic: nonce,
    delegation: i.delegation };
  const proof = { chainId: i.chainId, intentHash: hashObject(before.intent),
    bootstrapMaterialHash: before.bootstrap.materialHash!, protocolHash: i.protocolHash,
    safeBlock: { numberAtomic: "101", hash: testWord("101"), timestampAtomic: i.block.timestampAtomic },
    headBlock: { numberAtomic: "102", hash: testWord("102"), timestampAtomic: i.block.timestampAtomic },
    safeAccount: accountState, headAccount: accountState };
  s.rpc.observe = async () => ({ status: "permissions_invalidated", transactionHash: null, settlement: null,
    cursor: before.cursor, evidenceHash: hashObject(proof), reason: "gasless_bootstrap_permissions_invalidated",
    permissionInvalidation: proof });
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const final = await s.record(id);
  assert.equal(final.state, "failed_permissions_invalidated");
  assert.equal(final.userOperation.submissionAttempts, 0);
  assert.equal(final.settlement, null);
  assert.equal(s.rpc.sends.length, 0);
  const lease = await usage.load(identity, final.intent.allowlist!.reservationId);
  assert.equal(lease?.state, "released_unsubmitted");
  assert.equal(lease?.outcomeDigest, final.integrityHash);
  assert.equal((await usage.usage(identity, now)).amountAtomic, "0");
  assert.equal((await s.core.execute({ command: "operation.status", operationId: id })).ok, true);
  assert.equal((await s.prepare("after-unsubmitted-invalidation")).operation.state, "awaiting_approval");
});

test("historical unbound Base records refuse a new effect and observe prior synthetic submission only", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now });
  const prepared = (await s.prepare()).operation;
  const { allowlist: _binding, unsignedEnvelopeHash: _hash, ...unsigned } = prepared.intent;
  const intent = { ...unsigned, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(unsigned)) };
  const legacyId = s.state.operationId(s.profile, "legacy-saved-base-operation");
  const legacy = newGaslessOperation({ profileHash: prepared.profileHash, operationId: legacyId,
    idempotencyHash: s.state.idempotencyHash("legacy-saved-base-operation"), requestHash: prepared.requestHash, intent });
  await s.core.gasless.records.persist(legacy);
  const stopped = await s.core.execute({ command: "operation.resume", operationId: legacyId });
  assert.equal(stopped.ok, true, stopped.error?.message);
  assert.equal((await s.record(legacyId)).state, "failed_before_effect");
  assert.equal(s.rpc.sends.length, 0);

  const signedId = s.state.operationId(s.profile, "legacy-signed-base-operation");
  const signed = newGaslessOperation({ profileHash: prepared.profileHash, operationId: signedId,
    idempotencyHash: s.state.idempotencyHash("legacy-signed-base-operation"), requestHash: prepared.requestHash, intent });
  await s.core.gasless.records.persist(signed);
  const execute = new GaslessExecution(s.state, s.rpc, s.custody, () => now.getTime(), async (old, patch) => {
    const next = transitionGasless(old, patch, now.toISOString()); await s.core.gasless.records.persist(next); return next;
  }, s.wait);
  const prior = await execute.approve(signed, s.approval);
  assert.equal(prior.userOperation.submissionAttempts, 1);
  assert.equal(s.rpc.sends.length, 1);
  const recovery = await s.core.execute({ command: "operation.resume", operationId: signedId });
  assert.equal(recovery.ok, true, recovery.error?.message);
  assert.equal(s.rpc.sends.length, 1, "legacy recovery is observation only");
});
