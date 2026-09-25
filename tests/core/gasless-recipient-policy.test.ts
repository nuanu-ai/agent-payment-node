import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { validateAllowlistAdmission } from "../../src/allowlist-policy-overlay.js";
import { allowlistAdmissions } from "../../src/allowlist-policy-activation.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { localGaslessMechanism } from "../../src/gasless/asset-policy.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { gaslessFixture, GASLESS_TEST_RECIPIENT } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const now = new Date("2026-09-18T02:00:00.000Z");
const otherRecipient = "0x6666666666666666666666666666666666666666" as const;

async function activate(root: string, profile: string, owner: string, chainId: 1 | 8453, recipient?: string) {
  const store = new AllowlistPolicyStore(root), before = await store.read(profile);
  const head = before.entries.at(-1), latest = before.records.at(-1);
  const record = await store.stage({ profile, now, ...(latest === undefined ? {} : { expectedRevision: latest.revision }),
    policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `recipient.${before.records.length + 1}`,
      accounts: { evm: owner }, effectiveAt: new Date(now.getTime() - 1_000).toISOString(),
      admissions: [{ chain: `eip155:${chainId}`, kind: "token", identifier: gaslessDeployment(chainId).token,
        rail: "gasless", maximumPerTransferAtomic: "10000000", dailyLimitAtomic: "20000000",
        mechanism: localGaslessMechanism(chainId), ...(recipient === undefined ? {} : { recipient }) }] } });
  await store.appendDecision(profile, head?.entryDigest ?? null, { status: "active", revision: record.revision,
    stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest,
    registry: record.registry, approvalFingerprint: hashObject(`recipient-${record.revision}`), decidedAt: now.toISOString() });
  return record;
}

for (const chainId of [1, 8453] as const) {
  test(`${chainId} local gasless exact recipient refuses a different wallet before RPC or reservation`, async t => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, chainId, { now, activatePolicy: false });
    const record = await activate(temporary.root, s.profile, s.account.address, chainId, GASLESS_TEST_RECIPIENT);
    assert.equal(allowlistAdmissions(record.registry)[0]?.recipient, GASLESS_TEST_RECIPIENT);
    const denied = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
      request: { ...s.request, recipient: otherRecipient }, idempotencyKey: `wrong-recipient-${chainId}` });
    assert.equal(denied.ok, false);
    assert.equal(denied.error?.code, "APN_ALLOWLIST_REFUSED", JSON.stringify(denied.error));
    assert.equal(s.rpc.calls.length, 0);
    assert.equal((await s.core.gasless.records.listAllOperations()).length, 0);
    assert.equal((await new AssetUsageLedger(temporary.root).usage({ account: s.account.address,
      chain: `eip155:${chainId}`, asset: { kind: "token", identifier: gaslessDeployment(chainId).token } }, now)).amountAtomic, "0");
    const { operation } = await s.prepare(`right-recipient-${chainId}`);
    assert.equal(operation.intent.request.recipient, GASLESS_TEST_RECIPIENT);
    const tampered = { ...operation, intent: { ...operation.intent,
      request: { ...operation.intent.request, recipient: otherRecipient } } };
    await assert.rejects(s.core.gasless.policy.assert(tampered, false), { code: "APN_ALLOWLIST_REFUSED" });
  });

  test(`${chainId} recipient policy replacement stops approval before signing or reservation`, async t => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, chainId, { now, activatePolicy: false });
    await activate(temporary.root, s.profile, s.account.address, chainId, GASLESS_TEST_RECIPIENT);
    const { id, operation } = await s.prepare(`replace-${chainId}`);
    await activate(temporary.root, s.profile, s.account.address, chainId, otherRecipient);
    const result = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(result.ok, true, result.error?.message);
    const stopped = await s.record(id);
    assert.equal(stopped.state, "failed_before_effect");
    assert.equal(stopped.bootstrap.signingAttempts, 0);
    assert.equal(s.rpc.sends.length, 0);
    assert.equal(await new AssetUsageLedger(temporary.root).load({ account: s.account.address,
      chain: `eip155:${chainId}`, asset: { kind: "token", identifier: gaslessDeployment(chainId).token } },
      operation.intent.allowlist!.reservationId), null);
  });

  test(`${chainId} a changed saved recipient is refused by approve before any effect`, async t => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, chainId, { now, activatePolicy: false });
    await activate(temporary.root, s.profile, s.account.address, chainId, GASLESS_TEST_RECIPIENT);
    const { id, operation } = await s.prepare(`tampered-recipient-${chainId}`);
    const file = join(temporary.root, "gasless-operations", operation.profileHash, `${id}.json`);
    const saved = JSON.parse(await readFile(file, "utf8"));
    saved.intent.request.recipient = otherRecipient;
    await writeFile(file, JSON.stringify(saved));
    const result = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "APN_STATE_CORRUPT");
    assert.equal(s.rpc.sends.length, 0);
    assert.equal((await new AssetUsageLedger(temporary.root).usage({ account: s.account.address,
      chain: `eip155:${chainId}`, asset: { kind: "token", identifier: gaslessDeployment(chainId).token } }, now)).amountAtomic, "0");
  });

  test(`${chainId} existing unpinned gasless admission remains valid`, async t => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, chainId, { now, activatePolicy: false });
    const record = await activate(temporary.root, s.profile, s.account.address, chainId);
    assert.equal(record.registry.chains[0]?.assets[0]?.gaslessRecipient, undefined);
    const prepared = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
      request: { ...s.request, recipient: otherRecipient }, idempotencyKey: `legacy-unpinned-${chainId}` });
    assert.equal(prepared.ok, true, prepared.error?.message);
  });
}

test("recipient pin rejects wildcard, zero, noncanonical address and other rails", () => {
  const base = { chain: "eip155:8453", kind: "token", identifier: gaslessDeployment(8453).token,
    rail: "gasless", maximumPerTransferAtomic: "1", dailyLimitAtomic: "1",
    mechanism: localGaslessMechanism(8453) };
  for (const recipient of ["*", "0x0000000000000000000000000000000000000000", gaslessDeployment(1).token.toLowerCase()]) {
    assert.throws(() => validateAllowlistAdmission({ ...base, recipient }), { code: "APN_INVALID_INPUT" });
  }
  assert.throws(() => validateAllowlistAdmission({ ...base, rail: "x402", recipient: GASLESS_TEST_RECIPIENT }),
    { code: "APN_INVALID_INPUT" });
  assert.throws(() => validateAllowlistAdmission({ ...base, chain: "eip155:42161", recipient: GASLESS_TEST_RECIPIENT }),
    { code: "APN_INVALID_INPUT" });
});
