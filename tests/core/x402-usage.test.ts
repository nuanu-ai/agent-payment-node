import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { getAddress } from "viem";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { ApnCore } from "../../src/core.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import type { OperationAbandonApprovalPort } from "../../src/operation-abandon-approval.js";
import { StateStore } from "../../src/state.js";
import { x402UsageKey } from "../../src/x402-usage.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
import { TestClock, TestProfilePolicy, UUID, temporaryState } from "./helpers.js";
import { ExactX402Native, QueuedHttp, RecoveryRpc, X402_TEST_ACCOUNT, challengeObservation } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const IDENTITY = { account: getAddress(X402_TEST_ACCOUNT.address), chain: "eip155:8453",
  asset: { kind: "token" as const, identifier: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") } };

async function fixture(t: TestContext, paid: readonly Error[] = []) {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const clock = new TestClock();
  const approval: OperationAbandonApprovalPort = { approve: async () => undefined };
  const core = new ApnCore({ state: new StateStore(temporary.root, { lockWaitMs: 1_000 }), native: new ExactX402Native(), rpc,
    http: new QueuedHttp([challengeObservation(), challengeObservation(), ...paid]), clock, policy: new TestProfilePolicy(),
    operationAbandonApproval: approval, ids: { next: () => UUID } });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const ledger = new AssetUsageLedger(temporary.root);
  const prepare = async (key: string) => {
    const prepared = await core.execute({ command: "x402.fetch.prepare", profile: "default", url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey: key });
    return (prepared.operation as { readonly operationId: string }).operationId;
  };
  const reservation = async (operationId: string) => await ledger.load(IDENTITY, assetUsageReservationId(IDENTITY, x402UsageKey(operationId)));
  const usage = async () => (await ledger.usage(IDENTITY, clock.now())).amountAtomic;
  const stored = async (operationId: string) => await core.context.state.findX402Operation(operationId) as X402OperationRecord;
  return { core, rpc, clock, ledger, prepare, reservation, usage, stored, root: temporary.root };
}

test("approval reserves the payment in the shared daily usage before signing, once per operation", async (t) => {
  const f = await fixture(t);
  const first = await f.prepare("usage-first");
  assert.equal(await f.reservation(first), null, "prepare reserves nothing");
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId: first })).ok, true);
  assert.equal((await f.reservation(first))?.state, "reserved");
  assert.equal((await f.reservation(first))?.rail, "x402");
  const second = await f.prepare("usage-second");
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId: second })).ok, true);
  assert.equal(await f.usage(), "2500000", "concurrent purchases both count");
  // The test signer keeps only its latest material, so the second purchase is the one resumed here.
  const resumed = await f.core.execute({ command: "operation.resume", operationId: second });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((await f.reservation(second))?.state, "unknown_finality");
  assert.equal(await f.usage(), "2500000", "a resume never reserves again");
});

test("an expired never-sent authorization releases its hold; an expired approval reserves nothing", async (t) => {
  const f = await fixture(t);
  const sent = await f.prepare("usage-expired");
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId: sent })).ok, true);
  const late = await f.prepare("usage-late");
  f.clock.advance(61_000);
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId: late })).ok, true);
  assert.equal(await f.reservation(late), null);
  f.rpc.finalizedHead = { ...f.rpc.finalizedHead, timestamp: (await f.stored(sent)).authorization.validBefore, observedAt: f.clock.now().toISOString() };
  const closed = await f.core.execute({ command: "operation.resume", operationId: sent });
  assert.equal((closed.operation as { readonly state: string }).state, "failed_expired_unused");
  assert.equal((await f.reservation(sent))?.state, "released_unsubmitted");
  assert.equal(await f.usage(), "0");
});

test("an ambiguous send holds unknown finality and an owner abandonment charges it as spent", async (t) => {
  const f = await fixture(t, [new Error("ambiguous paid request")]);
  const operationId = await f.prepare("usage-abandon");
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  assert.equal((await f.core.execute({ command: "operation.resume", operationId })).ok, true);
  assert.equal((await f.stored(operationId)).state, "effect_unknown");
  assert.equal((await f.reservation(operationId))?.state, "unknown_finality");
  f.clock.advance(61_000);
  const abandoned = await f.core.execute({ command: "operation.abandon", operationId });
  assert.equal((abandoned.operation as { readonly state: string }).state, "abandoned_unknown", JSON.stringify(abandoned));
  const held = await f.reservation(operationId);
  assert.equal(held?.state, "finalized");
  assert.equal(held?.effectAt?.slice(0, 10), f.clock.now().toISOString().slice(0, 10));
  assert.equal(await f.usage(), "1250000");
});

test("an operation approved before the shared ledger existed keeps working without a reservation", async (t) => {
  const f = await fixture(t);
  const operationId = await f.prepare("usage-legacy");
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  const bucket = `asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson(IDENTITY))}`;
  await rm(join(f.root, bucket, `${assetUsageReservationId(IDENTITY, x402UsageKey(operationId))}.json`));
  const resumed = await f.core.execute({ command: "operation.resume", operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(await f.reservation(operationId), null);
});
