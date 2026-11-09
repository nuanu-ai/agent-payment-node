import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { OneClickSourceAdmission, oneClickUsageIdentity, settleOneClickUsage } from "../../src/lifi/near-oneclick-admission.js";
import { oneClickLane } from "../../src/lifi/near-oneclick-lanes.js";
import { OneClickSourceJournal } from "../../src/lifi/near-oneclick-source-journal.js";
import { oneClickOperationId } from "../../src/lifi/near-oneclick-source-service.js";
import { StateStore } from "../../src/state.js";
import { activateDirectPolicy, revokeDirectPolicy } from "./direct-allowlist-helpers.js";
import { harness, payer, recipient, request, usdc } from "./lifi-near-oneclick-base-harness.js";

const LANE = oneClickLane("base-usdc-to-tron-usdt");
const operationId = (root: string, key = request.idempotencyKey) =>
  oneClickOperationId(LANE, new StateStore(root).profileHash("imported"), key);
const hold = async (root: string, id: string) => {
  const identity = oneClickUsageIdentity(LANE, payer);
  return await new AssetUsageLedger(root).load(identity, assetUsageReservationId(identity, `oneclick-source:${id}`));
};
const untouched = async (h: Awaited<ReturnType<typeof harness>>) => {
  assert.equal(h.quotes(), 0); assert.equal(h.approvals(), 0); assert.equal(h.sends(), 0);
  assert.equal(await new OneClickSourceJournal(h.root).load(operationId(h.root)), null);
};

test("1Click refuses before any quote without an active owner policy, or after it is revoked", async t => {
  const none = await harness(t, false, true, undefined, 86_400_000, 0, null);
  await assert.rejects(none.service.submit(request), { code: "APN_ALLOWLIST_REFUSED", details: { reason: "oneclick_source_active_owner_policy_required" } });
  await untouched(none);
  const revoked = await harness(t);
  await revokeDirectPolicy(revoked.root, "imported");
  await assert.rejects(revoked.service.submit(request), { code: "APN_ALLOWLIST_REFUSED", details: { reason: "oneclick_source_active_owner_policy_required" } });
  await untouched(revoked);
});

test("a Base USDC bridge admission for another mechanism does not admit the 1Click lane", async t => {
  const h = await harness(t, false, true, undefined, 86_400_000, 0, null);
  await activateDirectPolicy(h.root, "imported", { accounts: { evm: payer }, admissions: [{ chain: "eip155:8453", kind: "token", identifier: usdc,
    rail: "bridge", maximumPerTransferAtomic: "5000000", dailyLimitAtomic: "10000000",
    mechanism: { provider: "circle-cctp-v2", reference: "circle-v2-base-solana-withfees.v1" } }] });
  await assert.rejects(h.service.submit(request), { code: "APN_ALLOWLIST_REFUSED", details: { reason: "oneclick_source_mechanism_not_admitted" } });
  await untouched(h);
});

test("the lane's per-operation cap and the owner's recipient pin refuse before any quote", async t => {
  const capped = await harness(t, false, true, undefined, 86_400_000, 0, [{ lane: LANE.id, maximumPerTransferAtomic: "2999999" }]);
  await assert.rejects(capped.service.submit(request), (error: any) => error.details?.reason === "oneclick_source_policy_refused" && /per-transfer cap/u.test(error.details?.cause));
  await untouched(capped);
  const pinned = await harness(t, false, true, undefined, 86_400_000, 0, [{ lane: LANE.id, recipients: ["TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS"] }]);
  await assert.rejects(pinned.service.submit(request), (error: any) => error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === "allowlist_recipient_not_admitted");
  await untouched(pinned);
});

test("an admitted deposit holds its principal from before signing, and status settles the hold from the receipt", async t => {
  const h = await harness(t, false, true, undefined, 86_400_000, 0, [{ lane: LANE.id, recipients: [recipient] }]);
  const submitted = await h.service.submit(request) as any;
  assert.equal(submitted.usageHold.state, "submitted"); assert.equal(submitted.usageHold.amountAtomic, "3000000");
  const observed = await h.service.status(submitted.operationId) as any;
  assert.equal(observed.sourceState, "source_observed"); assert.equal(observed.usageHold.state, "finalized");
  assert.equal((await hold(h.root, submitted.operationId))?.state, "finalized");
});

test("an ambiguous send keeps the hold open, and a reverted source releases it", async t => {
  const ambiguous = await harness(t, true);
  const first = await ambiguous.service.submit(request) as any;
  assert.equal(first.usageHold.state, "unknown_finality");
  const reverted = await harness(t);
  const sent = await reverted.service.submit(request) as any; reverted.revert();
  const observed = await reverted.service.status(sent.operationId) as any;
  assert.equal(observed.usageHold.state, "failed_confirmed_revert");
  // The journal answer repeats the settled hold without another transition.
  assert.equal((await reverted.service.status(sent.operationId) as any).usageHold.state, "failed_confirmed_revert");
});

test("the day's spend counts against the asset's daily limit before the next quote", async t => {
  const h = await harness(t, false, true, undefined, 86_400_000, 0, null);
  await activateDirectPolicy(h.root, "imported", { accounts: { evm: payer }, admissions: [{ chain: "eip155:8453", kind: "token", identifier: usdc,
    rail: "bridge", maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000", mechanism: { provider: "near-1click", reference: `${LANE.id}.v1` } }] });
  const first = await h.service.submit(request) as any;
  await h.service.status(first.operationId);
  await assert.rejects(h.service.submit({ ...request, idempotencyKey: "oneclick-second-day-cap" }), (error: any) => error.details?.reason === "oneclick_source_policy_refused" && /daily cap/u.test(error.details?.cause));
  assert.equal(h.quotes(), 2); assert.equal(h.sends(), 1);
});

test("a policy revoked during consent refuses the hold, so nothing is signed or held", async t => {
  let root = "";
  const h = await harness(t, false, true, async () => { await revokeDirectPolicy(root, "imported"); });
  root = h.root;
  await assert.rejects(h.service.submit(request), { code: "APN_ALLOWLIST_REFUSED", details: { reason: "oneclick_source_active_owner_policy_required" } });
  assert.equal(h.sends(), 0); assert.equal(await hold(h.root, operationId(h.root)), null);
  assert.equal((await new OneClickSourceJournal(h.root).load(operationId(h.root)))?.phase, "prepared");
});

test("a seal past the quote deadline is refused and the hold released without counting", async t => {
  const h = await harness(t);
  const reserve = AssetUsageLedger.prototype.reserve;
  // The hold is taken in time; the clock then passes the effective deadline before the seal.
  t.mock.method(AssetUsageLedger.prototype, "reserve", async function (this: AssetUsageLedger, ...args: Parameters<typeof reserve>) {
    const held = await reserve.apply(this, args); h.advance(200_000); return held;
  });
  await assert.rejects(h.service.submit(request), /oneclick_source_quote_expired_before_seal/u);
  assert.equal(h.sends(), 0);
  assert.equal((await hold(h.root, operationId(h.root)))?.state, "failed_before_effect");
  assert.equal((await new OneClickSourceJournal(h.root).load(operationId(h.root)))?.phase, "signing_started");
});

test("a run that died after the hold leaves it to status, which releases it once the deadline passed", async t => {
  const h = await harness(t);
  const advance = OneClickSourceJournal.prototype.advance;
  t.mock.method(OneClickSourceJournal.prototype, "advance", async function (this: OneClickSourceJournal, ...args: Parameters<typeof advance>) {
    if (args[2] === "signing_started") throw new Error("simulated process death");
    return await advance.apply(this, args);
  });
  t.mock.method(OneClickSourceAdmission.prototype, "releaseBeforeEffect", async () => { throw new Error("simulated process death"); });
  await assert.rejects(h.service.submit(request), /simulated process death/u);
  const id = operationId(h.root);
  assert.equal((await hold(h.root, id))?.state, "reserved");
  assert.equal((await h.service.status(id) as any).usageHold.state, "reserved");
  h.advance(200_000);
  await h.service.status(id);
  assert.equal((await hold(h.root, id))?.state, "failed_before_effect");
  assert.equal(h.sends(), 0);
});

test("a hold that status released before the seal refuses the seal, so nothing is signed out or sent", async t => {
  const h = await harness(t);
  const reserve = AssetUsageLedger.prototype.reserve;
  // As if status had released it under a stepped-back clock: the seal checks the hold's state, not only the time.
  t.mock.method(AssetUsageLedger.prototype, "reserve", async function (this: AssetUsageLedger, ...args: Parameters<typeof reserve>) {
    const held = await reserve.apply(this, args);
    await this.transition({ ...oneClickUsageIdentity(LANE, payer), reservationId: held.reservationId, policyDigest: held.policyDigest,
      state: "failed_before_effect", expectedCurrentStates: ["reserved"], now: new Date(Date.now()), outcomeDigest: "e".repeat(64) });
    return held;
  });
  await assert.rejects(h.service.submit(request), /oneclick_source_usage_hold_not_held/u);
  assert.equal(h.sends(), 0);
  assert.equal((await new OneClickSourceJournal(h.root).load(operationId(h.root)))?.phase, "signing_started");
});

test("settling follows every journal outcome, and a hold another run moved first only shortens the path", async t => {
  const h = await harness(t, true);
  const sent = await h.service.submit(request) as any;
  const record = (await new OneClickSourceJournal(h.root).load(sent.operationId))!;
  assert.equal(record.phase, "unknown_finality"); assert.equal(sent.usageHold.state, "unknown_finality");
  // A stale read (another run already moved the hold) makes the first transition fail; the next pass reads it fresh.
  const load = AssetUsageLedger.prototype.load, stale = (await hold(h.root, sent.operationId))!;
  let staleReads = 1;
  t.mock.method(AssetUsageLedger.prototype, "load", async function (this: AssetUsageLedger, ...args: Parameters<typeof load>) {
    if (staleReads-- > 0) return { ...stale, state: "reserved" as const };
    return await load.apply(this, args);
  });
  const pending = await settleOneClickUsage(h.root, { ...record, phase: "submitted_pending" }, new Date(Date.now()));
  assert.equal(pending?.state, "unknown_finality");
  const superseded = await settleOneClickUsage(h.root, { ...record, phase: "failed_proven_superseded", finalizedNonceAtomic: "8" }, new Date(Date.now()));
  assert.equal(superseded?.state, "released_unsubmitted");
  // Settled holds are left alone; a record with no hold (written before 0.5.98) answers null.
  assert.equal((await settleOneClickUsage(h.root, { ...record, phase: "source_observed", sourceReceiptStatus: "success" }, new Date(Date.now())))?.state,
    "released_unsubmitted");
  assert.equal(await settleOneClickUsage(h.root, { ...record, operationId: "f".repeat(64) }, new Date(Date.now())), null);
});

test("status settles the hold as soon as the source outcome is saved, even when the provider status read then fails", async t => {
  const h = await harness(t);
  const sent = await h.service.submit(request) as any;
  assert.equal(sent.usageHold.state, "submitted");
  h.failStatus();
  await assert.rejects(h.service.status(sent.operationId), /1Click status unavailable/u);
  assert.equal((await new OneClickSourceJournal(h.root).load(sent.operationId))?.phase, "source_observed");
  assert.equal((await hold(h.root, sent.operationId))?.state, "finalized");
});
