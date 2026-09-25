import assert from "node:assert/strict";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { localGaslessMechanism } from "../../src/gasless/asset-policy.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { gaslessFixture, GASLESS_TEST_RECIPIENT } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const now = new Date("2026-09-18T02:00:00.000Z");
const chain = "eip155:1" as const;
const token = gaslessDeployment(1).token;
const mechanism = localGaslessMechanism(1);

async function activate(root: string, profile: string, owner: string, options: {
  per?: string; daily?: string; pin?: { provider: string; reference: string };
} = {}) {
  const store = new AllowlistPolicyStore(root), before = await store.read(profile);
  const head = before.entries.at(-1), latest = before.records.at(-1);
  const record = await store.stage({ profile, now, ...(latest === undefined ? {} : { expectedRevision: latest.revision }),
    policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `ethereum-gasless.${before.records.length + 1}`,
      accounts: { evm: owner }, effectiveAt: new Date(now.getTime() - 1_000).toISOString(),
      admissions: [{ chain, kind: "token", identifier: token, rail: "gasless",
        maximumPerTransferAtomic: options.per ?? "10000000", dailyLimitAtomic: options.daily ?? "20000000",
        mechanism: options.pin ?? mechanism }] } });
  await store.appendDecision(profile, head?.entryDigest ?? null, { status: "active", revision: record.revision,
    stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest, registry: record.registry,
    approvalFingerprint: hashObject(`ethereum-gasless-${record.revision}`), decidedAt: now.toISOString() });
  return { store, record };
}

test("Ethereum USDC policy refuses missing, wrong account, wrong paymaster and cap before RPC", async t => {
  assert.equal(token, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.deepEqual(mechanism, { provider: "local", reference: `eip155:1:${gaslessDeployment(1).paymaster}` });
  for (const bad of ["missing", "account", "pin", "per_cap", "daily_cap"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, 1, { now, activatePolicy: false });
    if (bad !== "missing") {
      const { record } = await activate(temporary.root, s.profile,
      bad === "account" ? GASLESS_TEST_RECIPIENT : s.account.address,
      bad === "pin" ? { pin: { provider: "local", reference: "eip155:1:0x0000000000000000000000000000000000000001" } }
        : bad === "per_cap" ? { per: "9999999" } : bad === "daily_cap" ? { daily: "10000000" } : {});
      if (bad === "daily_cap") await new AssetUsageLedger(temporary.root).reserve({ account: s.account.address,
        chain, asset: { kind: "token", identifier: token }, registry: record.registry, rail: "gasless",
        mechanism, amountAtomic: "1", idempotencyKey: "other-operation", now });
    }
    const result = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
      request: s.request, idempotencyKey: `eth-denied-${bad}` });
    assert.equal(result.ok, false, bad);
    assert.equal(s.rpc.calls.length, 0, bad);
    assert.equal((await s.core.gasless.records.listAllOperations()).length, 0, bad);
  }
});

test("Ethereum prepare binds activation; approval reserves gross and resume finalizes one lease", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 1, { now, activatePolicy: false });
  const { record } = await activate(temporary.root, s.profile, s.account.address);
  const { id, operation } = await s.prepare();
  const binding = operation.intent.allowlist!;
  assert.equal(binding.chain, chain); assert.equal(binding.token, token);
  assert.equal(binding.policyDigest, record.registry.policyDigest);
  assert.equal(binding.policyRevision, record.revision);
  assert.deepEqual(binding.mechanism, mechanism);
  const usage = new AssetUsageLedger(temporary.root);
  const identity = { account: s.account.address, chain, asset: { kind: "token" as const, identifier: token } };
  assert.equal(await usage.load(identity, binding.reservationId), null);
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await usage.load(identity, binding.reservationId))?.state, "submitted");
  assert.equal((await usage.usage(identity, now)).amountAtomic, s.request.grossAtomic);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const final = await s.record(id), lease = await usage.load(identity, binding.reservationId);
  assert.equal(final.state, "completed"); assert.equal(lease?.state, "finalized");
  assert.equal(lease?.outcomeDigest, final.integrityHash);
  assert.equal(s.rpc.sends.length, 1);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal(s.rpc.sends.length, 1);
});

test("Ethereum changed activation blocks approval before first signature", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 1, { now, activatePolicy: false });
  const { store } = await activate(temporary.root, s.profile, s.account.address);
  const { id, operation } = await s.prepare();
  const head = (await store.read(s.profile)).entries.at(-1)!;
  await store.appendDecision(s.profile, head.entryDigest, { status: "revoked", revision: head.revision,
    stagedRecordDigest: head.stagedRecordDigest, policyDigest: head.policyDigest,
    approvalFingerprint: hashObject("revoke-ethereum-gasless"), decidedAt: now.toISOString() });
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const stopped = await s.record(id);
  assert.equal(stopped.state, "failed_before_effect");
  assert.equal(stopped.bootstrap.signingAttempts, 0); assert.equal(s.rpc.sends.length, 0);
  const usage = new AssetUsageLedger(temporary.root);
  assert.equal(await usage.load({ account: s.account.address, chain, asset: { kind: "token", identifier: token } },
    operation.intent.allowlist!.reservationId), null);
});

test("Ethereum revoked policy after send permits observation without another effect", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 1, { now, activatePolicy: false });
  const { store } = await activate(temporary.root, s.profile, s.account.address);
  const { id } = await s.prepare("eth-revoke-after-send");
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const head = (await store.read(s.profile)).entries.at(-1)!;
  await store.appendDecision(s.profile, head.entryDigest, { status: "revoked", revision: head.revision,
    stagedRecordDigest: head.stagedRecordDigest, policyDigest: head.policyDigest,
    approvalFingerprint: hashObject("eth-post-send-revoke"), decidedAt: now.toISOString() });
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const final = await s.record(id);
  assert.equal(final.state, "completed"); assert.equal(s.rpc.sends.length, 1);
  const usage = new AssetUsageLedger(temporary.root);
  const identity = { account: s.account.address, chain, asset: { kind: "token" as const, identifier: token } };
  assert.equal((await usage.load(identity, final.intent.allowlist!.reservationId))?.state, "finalized");
});

for (const fee of ["positive", "zero"] as const) {
  test(`Ethereum safe revert ${fee} fee consumes only proven USDC fee`, async t => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, 1, { now });
    const { id } = await s.prepare(`eth-revert-${fee}`);
    s.rpc.success = false; s.rpc.safeAllowance = "0";
    if (fee === "zero") {
      const observe = s.rpc.observe.bind(s.rpc);
      s.rpc.observe = async (intent, identity, cursor) => {
        const result = await observe(intent, identity, cursor);
        if (result.settlement === null) return result;
        const settlement = { ...result.settlement, accounting: { ...result.settlement.accounting,
          refundAtomic: result.settlement.accounting.prefundAtomic, feeAtomic: "0" } };
        return { ...result, settlement, evidenceHash: hashObject(settlement) };
      };
    }
    assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    const usage = new AssetUsageLedger(temporary.root);
    const identity = { account: s.account.address, chain, asset: { kind: "token" as const, identifier: token } };
    assert.equal((await usage.usage(identity, now)).amountAtomic, s.request.grossAtomic);
    assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
    const final = await s.record(id), lease = await usage.load(identity, final.intent.allowlist!.reservationId);
    assert.equal(final.state, "failed_confirmed_revert");
    assert.equal(final.settlement?.accounting.deliveredAtomic, "0");
    assert.equal(lease?.state, "failed_confirmed_revert");
    assert.equal(lease?.consumedAtomic, fee === "zero" ? "0" : "149925");
    assert.equal((await usage.usage(identity, now)).amountAtomic, lease?.consumedAtomic);
  });
}

test("Ethereum unknown finality keeps gross reserved and never sends twice", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 1, { now });
  const { id } = await s.prepare("eth-unknown-finality");
  s.rpc.timeout = true; s.rpc.result = "missing";
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  let op = await s.record(id);
  assert.equal(op.state, "unknown_finality"); assert.equal(s.rpc.sends.length, 1);
  const usage = new AssetUsageLedger(temporary.root);
  const identity = { account: s.account.address, chain, asset: { kind: "token" as const, identifier: token } };
  assert.equal((await usage.load(identity, op.intent.allowlist!.reservationId))?.state, "unknown_finality");
  assert.equal((await usage.usage(identity, now)).amountAtomic, s.request.grossAtomic);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  op = await s.record(id);
  assert.equal(op.state, "unknown_finality"); assert.equal(s.rpc.sends.length, 1);
  assert.equal((await usage.usage(identity, now)).amountAtomic, s.request.grossAtomic);
});
