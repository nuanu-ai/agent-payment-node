/**
 * Phase 4c (R4): every merchant payment state has an exit, run through the real CLI (`runCli`: argv, binder, runtime,
 * service, ledger, operation index). The merchant and MegaETH are the fixture's in-process fakes; nothing leaves the machine.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { canonicalJson } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { BridgeHttps } from "../../src/lifi/https.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { MerchantClaims } from "../../src/x402-merchant/claims.js";
import { merchantMove, type MerchantOperation } from "../../src/x402-merchant/model.js";
import { merchantNativeUsageIdentity, merchantNativeUsageKey, merchantUsageIdentity } from "../../src/x402-merchant/owner.js";
import { MerchantRepository } from "../../src/x402-merchant/repository.js";
import { MerchantService } from "../../src/x402-merchant/service.js";
import { merchantTerms } from "../../src/x402-merchant/terms.js";
import { temporaryState } from "./helpers.js";
import { MERCHANT_URL, merchantFixture, PROFILE, TX_HASH } from "./merchant-x402-fixtures.js";

type Fixture = Awaited<ReturnType<typeof merchantFixture>>;
class Approval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  async approve(intent: OperationAbandonIntent): Promise<void> { this.calls.push(intent); }
}
/** The fixture chain behind the real HTTP transport; `landed: false` hides the transaction, `finalizedNonce` is the payer's. */
async function setup(t: test.TestContext) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const f = await merchantFixture(temp.root), base = f.rpc.value.bind(f.rpc), chain = { landed: true, finalizedNonce: "0x0" };
  f.rpc.value = async (method, params) => !chain.landed && (method === "eth_getTransactionReceipt" || method === "eth_getTransactionByHash") ? null
    : method === "eth_getTransactionCount" && params[1] === "finalized" ? chain.finalizedNonce : await base(method, params);
  t.mock.method(BridgeHttps.prototype, "request", async (_url: string, _verb: string, body?: string) => {
    const request = JSON.parse(body!) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
    const rows = Array.isArray(request) ? request : [request];
    const results = await Promise.all(rows.map(async row => ({ jsonrpc: "2.0", id: row.id, result: await f.rpc.value(row.method, row.params) })));
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? results : results[0]) };
  });
  return { f, chain };
}
const options = (f: Fixture, extra: Record<string, unknown> = {}) => ({ stateRoot: f.state.root, clock: { now: f.now }, http: f.http, ...extra });
const merchant = (f: Fixture, ...args: string[]) => runCli(["x402", "merchant", ...args], {}, options(f) as never);
const data = (r: OutputEnvelope) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data as { state: string; terminal: boolean; exit: unknown; paymentFinalized: boolean; receipt: unknown }; };
async function usage(f: Fixture, o: MerchantOperation): Promise<readonly string[]> {
  const ledger = new AssetUsageLedger(f.state.root), t = merchantTerms(o);
  return [(await ledger.usage(merchantUsageIdentity(t), f.now())).amountAtomic, (await ledger.usage(merchantNativeUsageIdentity(t), f.now())).amountAtomic];
}
async function indexState(f: Fixture, id: string): Promise<string | undefined> {
  const index = new OperationIndex(f.state); await index.settle(id); return (await index.find(id))?.state;
}
const HELD = ["1000000000000000", "2000000000000"], FREE = ["0", "0"];
const prepare = (f: Fixture) => f.service.prepare({ profile: PROFILE, url: MERCHANT_URL,
  maximumNativeFee: "100000000000000", nativeFeeReserveWei: HELD[1]!, idempotencyKey: "merchant-exits-0001" });
/** An approve whose custody seals the signed bytes (merchant-material) and then fails: never sent, bytes durable. */
function sealingService(f: Fixture, o: MerchantOperation) {
  return new MerchantService(f.state, { rpc: f.rpc, http: f.http, now: f.now, approve: async () => { f.rpc.operation = o; }, custody: { sign: async () => "0x02",
    verify: async () => TX_HASH, seal: async op => {
      await mkdir(join(f.state.root, "merchant-material"), { recursive: true, mode: 0o700 });
      await writeFile(join(f.state.root, "merchant-material", `${op.operationId}.json`), `${canonicalJson({ schemaVersion: "apn.merchant-material.v1",
        operationId: op.operationId, profileHash: op.profileHash, fingerprint: op.fingerprint, txHash: TX_HASH, materialHash: "f".repeat(64) })}\n`, { mode: 0o600 });
      throw new Error("synthetic seal failure after the durable write");
    } } });
}

test("a finalized payment whose 16th delivery row is not HTTP 200 ends delivery_failed on its own; receipt, proof and charge stay", async t => {
  const { f } = await setup(t), o = await prepare(f); f.failDelivery();
  assert.equal((await f.service.approve(o.operationId)).deliveryAttempts.length, 2);
  // Six retries through the service (the CLI's RPC pacing is real time), the last one through the CLI.
  for (let retry = 0; retry < 6; retry++) assert.equal((await f.service.observe(o.operationId, true)).state, "delivery_unknown");
  assert.equal(await indexState(f, o.operationId), "active");
  const done = data(await merchant(f, "observe", "--operation", o.operationId, "--deliver"));
  assert.deepEqual([done.state, done.terminal, done.paymentFinalized, done.exit], ["delivery_failed", true, true, { reason: "delivery_attempts_exhausted" }]);
  assert.notEqual(done.receipt, null);
  assert.deepEqual([f.headers.length, new Set(f.headers).size, f.rpc.sends], [8, 1, 1]);
  assert.equal((await usage(f, o))[0], HELD[0]);
  assert.equal(await indexState(f, o.operationId), "terminal");
  // No further GET: the exhausted proof is never offered again.
  assert.equal(data(await merchant(f, "observe", "--operation", o.operationId, "--deliver")).state, "delivery_failed");
  assert.equal(f.headers.length, 8);
});

test("an exhausted delivery_unknown record an earlier version wrote ends delivery_failed on a plain observe, with no GET", async t => {
  const { f } = await setup(t), o = await prepare(f); f.failDelivery();
  let op = await f.service.approve(o.operationId);
  const proofHash = op.deliveryAttempts[0]!.proofHash, at = f.now().toISOString(), records = new MerchantRepository(f.state.root);
  for (let i = 0; i < 7; i++) {
    op = merchantMove(op, "delivery_unknown", at, { deliveryAttempts: [...op.deliveryAttempts, { at, proofHash, outcome: "started" }, { at, proofHash, outcome: "unknown" }] });
    await records.persist(op);
  }
  assert.equal(op.deliveryAttempts.length, 16);
  const done = data(await merchant(f, "observe", "--operation", o.operationId));
  assert.deepEqual([done.state, done.exit], ["delivery_failed", { reason: "delivery_attempts_exhausted" }]);
  assert.equal(f.headers.length, 1);
});

test("a crash between the hold reservation and signing_started: observe releases the holds once the deadline passed, never before", async t => {
  const { f } = await setup(t), o = await prepare(f), persist = MerchantRepository.prototype.persist;
  const crash = t.mock.method(MerchantRepository.prototype, "persist", async function (this: MerchantRepository, op: MerchantOperation) {
    if (op.state === "signing_started") throw new Error("synthetic crash"); return await persist.call(this, op);
  });
  await assert.rejects(f.service.approve(o.operationId)); crash.mock.restore();
  assert.deepEqual(await usage(f, o), HELD);
  const early = await merchant(f, "observe", "--operation", o.operationId);
  assert.equal(early.error?.details?.reason, "merchant_observer_has_no_transaction_claim");
  assert.deepEqual(await usage(f, o), HELD);
  f.advance(300_001);
  const closed = data(await merchant(f, "observe", "--operation", o.operationId));
  assert.deepEqual([closed.state, closed.terminal, closed.exit], ["failed_before_effect", true, { reason: "never_signed" }]);
  assert.deepEqual(await usage(f, o), FREE);
  assert.deepEqual([f.signs(), f.rpc.sends], [0, 0]);
});

test("a crash after signing_started but before the SIGN claim: never signed, released after the deadline; open and held before", async t => {
  const { f } = await setup(t), o = await prepare(f), claim = MerchantClaims.prototype.claim;
  const crash = t.mock.method(MerchantClaims.prototype, "claim", async function (this: MerchantClaims, op: MerchantOperation, effect: "sign" | "send", hash?: string | null) {
    if (effect === "sign") throw new Error("synthetic crash"); return await claim.call(this, op, effect, hash);
  });
  await assert.rejects(f.service.approve(o.operationId)); crash.mock.restore();
  const open = data(await merchant(f, "observe", "--operation", o.operationId));
  assert.deepEqual([open.state, open.terminal], ["signing_started", false]);
  assert.deepEqual(await usage(f, o), HELD);
  f.advance(300_001);
  assert.deepEqual(data(await merchant(f, "observe", "--operation", o.operationId)).exit, { reason: "never_signed" });
  assert.deepEqual(await usage(f, o), FREE);
});

test("a crash while custody signs (SIGN claim, nothing sealed or sent): the signature never left the process", async t => {
  const { f } = await setup(t), o = await prepare(f), persist = MerchantRepository.prototype.persist;
  const service = new MerchantService(f.state, { rpc: f.rpc, http: f.http, now: f.now, approve: async () => { f.rpc.operation = o; },
    custody: { sign: async () => { throw new Error("process died in custody"); }, verify: async () => TX_HASH, seal: async () => {} } });
  // The process dies before the failure is recorded: the record stays signing_started behind its SIGN claim.
  const crash = t.mock.method(MerchantRepository.prototype, "persist", async function (this: MerchantRepository, op: MerchantOperation) {
    if (op.state === "unknown_finality") throw new Error("synthetic crash"); return await persist.call(this, op);
  });
  await assert.rejects(service.approve(o.operationId)); crash.mock.restore();
  f.advance(300_001);
  const closed = data(await merchant(f, "observe", "--operation", o.operationId));
  assert.deepEqual([closed.state, closed.exit], ["failed_before_effect", { reason: "signature_never_left_process" }]);
  assert.deepEqual(await usage(f, o), FREE);
});

test("sealed signed bytes never sent: open and held while the finalized nonce is not past; superseded once it is", async t => {
  const { f, chain } = await setup(t), o = await prepare(f); chain.landed = false;
  const failed = await sealingService(f, o).approve(o.operationId);
  assert.deepEqual([failed.state, failed.submissionAttempts], ["unknown_finality", 0]);
  f.advance(300_001);
  assert.equal(data(await merchant(f, "observe", "--operation", o.operationId)).state, "unknown_finality");
  assert.deepEqual(await usage(f, o), HELD);
  assert.equal(await indexState(f, o.operationId), "active");
  chain.finalizedNonce = "0x1";
  const done = data(await merchant(f, "observe", "--operation", o.operationId));
  assert.deepEqual([done.state, done.exit], ["failed_proven_superseded", { reason: "finalized_nonce_superseded", finalizedNonce: "1", transactionHash: TX_HASH }]);
  assert.deepEqual(await usage(f, o), FREE);
  assert.equal(await indexState(f, o.operationId), "terminal");
  assert.equal(f.rpc.sends, 0);
});

test("a sent transaction that never lands: open while the finalized nonce is not past, superseded with both holds released once it is", async t => {
  const { f, chain } = await setup(t), o = await prepare(f); f.rpc.lost = true; chain.landed = false;
  const sent = await f.service.approve(o.operationId);
  assert.deepEqual([sent.state, sent.submissionAttempts, sent.txHash], ["unknown_finality", 1, TX_HASH]);
  assert.equal(data(await merchant(f, "observe", "--operation", o.operationId)).state, "unknown_finality");
  assert.deepEqual(await usage(f, o), HELD);
  chain.finalizedNonce = "0x1";
  assert.equal(data(await merchant(f, "observe", "--operation", o.operationId)).state, "failed_proven_superseded");
  assert.deepEqual(await usage(f, o), FREE);
  const identity = merchantNativeUsageIdentity(merchantTerms(o));
  const native = await new AssetUsageLedger(f.state.root).load(identity, assetUsageReservationId(identity, merchantNativeUsageKey(o.operationId)));
  assert.deepEqual([native?.state, native?.consumedAtomic], ["failed_confirmed_revert", undefined]);
  assert.equal(f.rpc.sends, 1);
});

test("owner abandon: refused before the deadline; after it, TTY consent ends abandoned_unknown with both holds charged; a replay asks nothing", async t => {
  const { f, chain } = await setup(t), o = await prepare(f); chain.landed = false;
  await sealingService(f, o).approve(o.operationId);
  const approval = new Approval(), abandon = () => runCli(["operation", "abandon", "--operation", o.operationId], {}, options(f, { operationAbandonApproval: approval }) as never);
  const early = await abandon();
  assert.equal(early.error?.details?.reason, "merchant_abandon_before_deadline");
  f.advance(300_001);
  const done = await abandon();
  assert.equal(done.ok, true, JSON.stringify(done.error));
  assert.match(JSON.stringify(done.operation ?? done.data), /"state":"abandoned_unknown"/u);
  assert.equal(approval.calls.length, 1);
  assert.equal(approval.calls[0]!.recipient, merchantTerms(o).payee);
  assert.deepEqual(await usage(f, o), HELD);
  assert.equal(await indexState(f, o.operationId), "terminal");
  assert.equal((await abandon()).ok, true);
  assert.equal(approval.calls.length, 1);
  assert.equal(f.rpc.sends, 0);
});

test("owner abandon refuses a sent payment whose transaction has a receipt: observe records it", async t => {
  const { f } = await setup(t), o = await prepare(f); f.rpc.lost = true;
  await f.service.approve(o.operationId); f.advance(300_001);
  const approval = new Approval();
  const refused = await runCli(["operation", "abandon", "--operation", o.operationId], {}, options(f, { operationAbandonApproval: approval }) as never);
  assert.equal(refused.error?.details?.reason, "merchant_abandon_receipt_exists");
  assert.equal(approval.calls.length, 0);
  assert.notEqual(data(await merchant(f, "observe", "--operation", o.operationId)).receipt, null);
});
