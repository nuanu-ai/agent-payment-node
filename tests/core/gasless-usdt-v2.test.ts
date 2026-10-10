import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { hashObject } from "../../src/canonical.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { StateStore } from "../../src/state.js";
import { EncryptedWalletStore, walletCustodyLock } from "../../src/encrypted-wallet-store.js";
import { preparePolicyBoundUsdtV2 } from "../../src/gasless-usdt/policy-prepare-v2.js";
import { preparePolicyBoundUsdt } from "../../src/gasless-usdt/policy-prepare.js";
import { UsdtBoundOperationRepository, validateUsdtAnyBoundOperation } from "../../src/gasless-usdt/bound-operation.js";
import { UsdtOperationRepository } from "../../src/gasless-usdt/operation.js";
import { GaslessUsdtOperationService } from "../../src/gasless-usdt/service.js";
import { GaslessUsdtCommandPrepare, UsdtCommandReadBudget } from "../../src/gasless-usdt/command-prepare.js";
import { GaslessUsdtCommandExecute } from "../../src/gasless-usdt/command-execute.js";
import { LocalUsdtSigningService } from "../../src/gasless-usdt/local-signing.js";
import { usdtUserOperationHash } from "../../src/gasless-usdt/userop.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { runCli } from "../../src/cli.js";
import { temporaryState } from "./helpers.js";
import { v2Fixture, V2_NOW, V2Wrapping, V2_KEY, V2_OWNER, V2_RECIPIENT } from "./gasless-usdt-v2-fixture.js";

async function setup(delegation: "empty" | "expected" = "empty", mode = "02") {
  const temporary = await temporaryState(), state = new StateStore(temporary.root); await state.initialize();
  const f = v2Fixture(delegation, mode), wrapping = new V2Wrapping();
  await new EncryptedWalletStore(state, wrapping).importNew("owner", V2_KEY, V2_OWNER); wrapping.loads = 0;
  const prepared = await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor }, f.request);
  const bound = await new UsdtBoundOperationRepository(state.root).create(allowlistProfileHash("owner"), prepared, "v2-001", f.now());
  const expected = { profile: "owner", profileHash: bound.profileHash, operationId: bound.operationId, bindingHash: bound.binding.bindingHash };
  const signer = new LocalUsdtSigningService(state, wrapping, f.now);
  return { f, state, wrapping, bound, expected, signer, temporary };
}

test("cloned prepared v2 binding cannot publish a new operation or claim; genuine async-auth grant still publishes", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = v2Fixture(), repository = new UsdtBoundOperationRepository(temporary.root);
  const prepared = await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor }, f.request);
  assert.equal(f.state.reads.length, 1);
  await assert.rejects(repository.create(allowlistProfileHash("owner"), structuredClone(prepared), "cloned-grant-001", f.now()));
  assert.deepEqual(await readdir(`${temporary.root}/gasless-usdt-bound-operations/claims`), []);
  assert.deepEqual(await readdir(`${temporary.root}/gasless-usdt-bound-operations/${allowlistProfileHash("owner")}`), []);
  const saved = await repository.create(allowlistProfileHash("owner"), prepared, "genuine-grant-001", f.now());
  assert.equal(saved.schemaVersion, "apn.gasless-usdt-bound-operation.v2");
  assert.equal((await readdir(`${temporary.root}/gasless-usdt-bound-operations/claims`)).length, 1);
});

test("v2 authentic signed economics admits initial estimate aboveF and records exact changed facts; mode03 cold/warm", async t => {
  for (const delegation of ["empty", "expected"] as const) {
    const f = await setup(delegation, "03"); t.after(f.temporary.cleanup);
    assert.equal(f.bound.schemaVersion, "apn.gasless-usdt-bound-operation.v2");
    if (f.bound.schemaVersion !== "apn.gasless-usdt-bound-operation.v2") throw new Error("v2 missing");
    assert.equal(f.bound.binding.plan.quotedFeeAtomic, "455822"); assert.equal(f.bound.binding.plan.feeCapAtomic, "999999");
    assert.equal(f.bound.binding.plan.netAtomic, "1"); assert.equal(f.bound.binding.plan.price.maxFeePerGas, "305256480");
    assert.equal(f.bound.binding.unsignedOperation.signature, "0x");
    assert.equal("exchangeRateNativeToUsd" in f.bound.binding.plan.quote, false);
    assert.deepEqual(f.bound.binding.quoteFacts.changedFields, ["quote.exchangeRate", "quote.exchangeRateNativeToUsd", "price.maxFeePerGas"]);
    assert.equal(f.f.state.reads.length, 1);
  }
});

test("prepare refuses authentic overflow, malformed quote, unavailable auth and warm member/parity/pin failure before operation/hold", async t => {
  for (const mutate of [(f: ReturnType<typeof v2Fixture>) => { f.state.signedRate = 100_000_000_000n; },
    (f: ReturnType<typeof v2Fixture>) => { f.state.member = false; }, (f: ReturnType<typeof v2Fixture>) => { f.state.parity = false; },
    (f: ReturnType<typeof v2Fixture>) => { f.state.snapshot.pins.paymaster = `0x${"00".repeat(32)}`; },
    (f: ReturnType<typeof v2Fixture>) => { f.sponsor.tokenQuote = async () => ({ quotes: [] }); },
    (f: ReturnType<typeof v2Fixture>) => { delete f.prepare.sponsorAuth; }]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const f = v2Fixture("expected"); mutate(f);
    const state = new StateStore(temporary.root); await state.initialize(); const service = new GaslessUsdtCommandPrepare(state, { now: f.now },
      new GaslessUsdtOperationService(new UsdtOperationRepository(state.root)), { preparePort: f.prepare, sponsorPort: f.sponsor });
    await assert.rejects(service.prepare({ command: "gasless.usdt.prepare", profile: "owner", recipient: V2_RECIPIENT,
      grossAtomic: "1000000", maxFeeAtomic: "999999", minReceivedAtomic: "1", idempotencyKey: "fail-001" }));
    assert.equal((await readdir(temporary.root)).includes("gasless-usdt-bound-operations"), false);
    assert.equal((await readdir(temporary.root)).includes("asset-usage-ledger"), false);
  }
});

test("signed postOp differing from estimate is authoritative when authentic and within frozen cap", async () => {
  const f = v2Fixture(); f.state.signedPostOp = 30000n;
  const p = await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor }, f.request);
  assert.equal(p.plan.quote.postOpGas, 30000n); assert.equal(p.plan.price.maxFeePerGas, 305256480n);
  assert.equal(p.plan.quotedFeeAtomic <= p.plan.feeCapAtomic, true);
});

test("legacy first claim replays byte-for-byte under defaultv2 with no auth backfill or second claim", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = v2Fixture(); f.state.initialRate = f.state.signedRate;
  const quote = await f.sponsor.tokenQuote(), price = await f.sponsor.gasPrice();
  const legacy = await preparePolicyBoundUsdt({ prepare: f.prepare,
    sponsor: { ...f.sponsor, tokenQuote: async () => quote, gasPrice: async () => price } }, f.request);
  const repository = new UsdtBoundOperationRepository(temporary.root);
  const original = await repository.create(allowlistProfileHash("owner"), legacy, "shared-001", f.now());
  f.prepare.activePolicy = async () => { throw new Error("no fresh read"); };
  f.prepare.sponsorAuth = async () => { throw new Error("no auth backfill"); };
  const service = new GaslessUsdtCommandPrepare(new StateStore(temporary.root), { now: f.now },
    new GaslessUsdtOperationService(new UsdtOperationRepository(temporary.root)), { preparePort: f.prepare, sponsorPort: f.sponsor });
  const replay = await service.prepare({ command: "gasless.usdt.prepare", profile: "owner", recipient: V2_RECIPIENT,
    grossAtomic: "1000000", maxFeeAtomic: "999999", minReceivedAtomic: "1", idempotencyKey: "shared-001" });
  assert.deepEqual(replay, original); assert.equal(f.state.reads.length, 0);
  const claims = await readdir(`${temporary.root}/gasless-usdt-bound-operations/claims`);
  assert.deepEqual(claims, [`${hashObject({ schemaVersion: "apn.gasless-usdt-bound-operation.v1", idempotencyKey: "shared-001" })}.json`]);
});

test("strict v2 codec rejects rehashed version/economic/auth tampering and restart reads exact saved version", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  const restored = await new UsdtBoundOperationRepository(f.state.root).load(f.bound.profileHash, f.bound.operationId);
  assert.deepEqual(restored, f.bound);
  for (const mutate of [(b: any) => { b.schemaVersion = "apn.gasless-usdt-bound-operation.v1"; },
    (b: any) => { b.binding.plan.quotedFeeAtomic = "1"; }, (b: any) => { b.binding.sponsorAuth.parityHash = `0x${"00".repeat(32)}`; },
    (b: any) => { b.binding.quoteFacts.changedFields = []; }, (b: any) => { b.binding.unsignedOperation.maxFeePerGas = "0x1"; }]) {
    const clone = structuredClone(f.bound) as any; mutate(clone);
    const { bindingHash: _b, ...body } = clone.binding; clone.binding.bindingHash = hashObject(body);
    clone.operationId = hashObject({ schemaVersion: clone.schemaVersion, profileHash: clone.profileHash, idempotencyKey: clone.idempotencyKey, bindingHash: clone.binding.bindingHash });
    const { integrityHash: _i, ...record } = clone; clone.integrityHash = hashObject(record);
    assert.throws(() => validateUsdtAnyBoundOperation(clone));
  }
});

test("v2 direct signer refuses missing/forged/expired permits before key access; permit cannot be reused or shared", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  await assert.rejects(f.signer.sign(f.bound, f.expected), /permit_missing_or_expired/u);
  assert.equal(f.wrapping.loads, 0);
  const permit = await f.f.prepare.sponsorPermit!(f.bound, f.expected, f.f.snapshot);
  const parallel = await Promise.allSettled([f.signer.sign(f.bound, f.expected, permit), f.signer.sign(f.bound, f.expected, permit)]);
  assert.equal(parallel.filter(v => v.status === "fulfilled").length, 1);
  assert.equal(f.wrapping.loads, 1);
  await assert.rejects(f.signer.sign(f.bound, f.expected, { kind: "usdt-sponsor-custody-permit" }), /permit_missing_or_expired/u);
  const stale = await f.f.prepare.sponsorPermit!(f.bound, f.expected, f.f.snapshot);
  f.f.advance(5001); await assert.rejects(f.signer.sign(f.bound, f.expected, stale), /permit_missing_or_expired/u);
  assert.equal(f.wrapping.loads, 1);
});

test("queued custody lock makes permit expire without retry/key access", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  const permit = await f.f.prepare.sponsorPermit!(f.bound, f.expected, f.f.snapshot);
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>(resolve => { locked = resolve; });
  const lock = f.state.withLocks([walletCustodyLock(f.state, "owner")], async () => { locked(); await new Promise<void>(resolve => { release = resolve; }); });
  await held; const signing = f.signer.sign(f.bound, f.expected, permit); f.f.advance(5001); release(); await lock;
  await assert.rejects(signing, /permit_missing_or_expired/u); assert.equal(f.wrapping.loads, 0);
});

test("permit binds exact operation and wallet identity; saved signer evidence cannot authorize a different signer", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  const permit = await f.f.prepare.sponsorPermit!(f.bound, f.expected, f.f.snapshot);
  const prepared = await preparePolicyBoundUsdtV2({ prepare: f.f.prepare, sponsor: f.f.sponsor }, f.f.request);
  const second = await new UsdtBoundOperationRepository(f.state.root).create(f.bound.profileHash, prepared, "v2-002", f.f.now());
  const secondIdentity = { ...f.expected, operationId: second.operationId, bindingHash: second.binding.bindingHash };
  await assert.rejects(f.signer.sign(second, secondIdentity, permit), /permit_missing_or_expired/u);
  assert.equal(f.wrapping.loads, 0);
  await assert.rejects(f.f.prepare.sponsorPermit!(f.bound, { ...f.expected, profile: "foreign" }, f.f.snapshot), /permit_identity/u);
  const changed = structuredClone(f.bound) as any; changed.binding.sponsorAuth.signer = V2_OWNER;
  const { bindingHash: _b, ...body } = changed.binding; changed.binding.bindingHash = hashObject(body);
  changed.operationId = hashObject({ schemaVersion: changed.schemaVersion, profileHash: changed.profileHash,
    idempotencyKey: changed.idempotencyKey, bindingHash: changed.binding.bindingHash });
  const { integrityHash: _i, ...record } = changed; changed.integrityHash = hashObject(record);
  const structurallyValid = validateUsdtAnyBoundOperation(changed);
  await assert.rejects(f.f.prepare.sponsorPermit!(structurallyValid, { ...f.expected, operationId: changed.operationId,
    bindingHash: changed.binding.bindingHash }, f.f.snapshot), /sponsor_identity_changed/u);
  assert.equal(f.wrapping.loads, 0);
});

test("execution membership removal and async secret expiry remain unsigned/no send with cancelled hold", async t => {
  for (const secretExpiry of [false, true]) {
    const f = await setup("expected"); t.after(f.temporary.cleanup); let sends = 0;
    if (secretExpiry) f.wrapping.onLoad = async () => { f.f.advance(241000); }; else f.f.state.member = false;
    const execute = new GaslessUsdtCommandExecute(f.state, { now: f.f.now }, f.wrapping,
      { preparePort: f.f.prepare, signer: f.signer, approval: { approve: async () => {} }, sendTransport: { send: async op => { sends++; return usdtUserOperationHash(op); } } });
    await assert.rejects(execute.execute(f.bound.profileHash, f.bound.operationId));
    assert.equal(sends, 0); assert.equal(f.wrapping.loads, secretExpiry ? 1 : 0);
    const status = await execute.status(f.bound.profileHash, f.bound.operationId); assert.equal(status.execution?.state, "failed_before_effect");
    const usage = await new AssetUsageLedger(f.state.root).usage({ account: V2_OWNER, chain: USDT_GASLESS.chain,
      asset: { kind: "token", identifier: USDT_GASLESS.token } }, f.f.now()); assert.equal(usage.amountAtomic, "0");
  }
});

test("CLI default v2 projection and status redact raw signature-bearing bytes and label captured evidence", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = v2Fixture();
  const options = { stateRoot: temporary.root, clock: { now: f.now }, gaslessUsdtPrepareOptions: { preparePort: f.prepare, sponsorPort: f.sponsor } };
  const outcome = await runCli(["gasless", "usdt", "prepare", "--profile", "owner", "--to", V2_RECIPIENT, "--amount", "1",
    "--max-fee", "0.999999", "--min-received", "0.000001", "--idempotency-key", "cli-v2-001"], {}, options);
  assert.equal(outcome.ok, true, JSON.stringify(outcome.error)); const text = JSON.stringify(outcome.operation);
  assert.match(text, /point_in_time_capture_not_current_authorization/u); assert.doesNotMatch(text, /paymasterData|unsignedOperation|"signature"|eip7702Auth/u);
});

test("scoped prepare8 and execute7 admission ceilings retain truthful physical fake dispatch count", async t => {
  for (const scope of ["execute", "prepare-v2"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup); let now = V2_NOW.getTime(), physical = 0;
    const budget = new UsdtCommandReadBudget(new StateStore(temporary.root), { request: async () => { physical++; return { status: 200, body: "{}" }; } },
      () => now, async ms => { now += ms; }, scope);
    const expected = scope === "execute" ? 7 : 8;
    for (let i = 0; i < expected; i++) await budget.request("https://rpc.test/", "POST", "{}", 1024, "APN_RPC_CONFIG");
    await assert.rejects(budget.request("https://rpc.test/", "POST", "{}", 1024, "APN_RPC_CONFIG"), /budget/u);
    assert.equal(budget.count(), expected); assert.equal(physical, expected);
  }
});


test("long secret retrieval with still-valid sponsorship expires authentication age before any wallet signature/send", async t => {
  const f = await setup(); t.after(f.temporary.cleanup); let sends = 0;
  f.wrapping.onLoad = async () => { f.f.advance(5001); };
  const execute = new GaslessUsdtCommandExecute(f.state, { now: f.f.now }, f.wrapping,
    { preparePort: f.f.prepare, signer: f.signer, approval: { approve: async () => {} }, sendTransport: { send: async op => { sends++; return usdtUserOperationHash(op); } } });
  await assert.rejects(execute.execute(f.bound.profileHash, f.bound.operationId), /expired_before_signature/u);
  assert.equal(sends, 0); assert.equal(f.wrapping.loads, 1); assert.equal((await execute.status(f.bound.profileHash, f.bound.operationId)).execution?.state, "failed_before_effect");
});

test("v2 owner signing and send happen once after3fresh snapshot guards and1auth batch, with shared crossrail cap refusal", async t => {
  for (const blocked of [false, true]) {
    const f = await setup("expected", "03"); t.after(f.temporary.cleanup); let sends = 0;
    if (blocked) for (const idempotencyKey of ["direct-hold-001", "direct-hold-002"]) await new AssetUsageLedger(f.state.root).reserve({ account: V2_OWNER,
      chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token }, registry: f.f.state.current!.registry,
      rail: "direct", amountAtomic: "1000000", idempotencyKey, now: f.f.now() });
    const execute = new GaslessUsdtCommandExecute(f.state, { now: f.f.now }, f.wrapping,
      { preparePort: f.f.prepare, signer: f.signer, approval: { approve: async () => {} }, sendTransport: { send: async op => { sends++; return usdtUserOperationHash(op); } } });
    if (blocked) { await assert.rejects(execute.execute(f.bound.profileHash, f.bound.operationId)); assert.equal(f.wrapping.loads, 0); assert.equal(sends, 0); }
    else {
      const result = await execute.execute(f.bound.profileHash, f.bound.operationId);
      assert.equal(result.state, "submitted_pending"); assert.equal(sends, 1); assert.equal(f.wrapping.loads, 1);
      assert.equal(f.f.state.snapshots, 4); // initial prepare + two reserve guards + submitting guard
      assert.equal(f.f.state.reads.length, 2); // prepare auth + exposure auth; each exactly one2call batch
      await assert.rejects(execute.execute(f.bound.profileHash, f.bound.operationId)); assert.equal(sends, 1);
    }
  }
});

test("one shared execution budget observes exactly7fake physical posts for3two-batch snapshots plus1auth, send separate", async t => {
  const f = await setup("expected"); t.after(f.temporary.cleanup);
  const { mintUsdtSponsorPermit } = await import("../../src/gasless-usdt/sponsor-permit.js");
  let physicalFakePosts = 0, logicalCalls = 0, sends = 0;
  const transport = { request: async (_url: string, _method: "POST" | "GET", body: string | null) => {
    physicalFakePosts++; const calls = JSON.parse(body!) as { id: string; method: string; params: unknown[] }[]; logicalCalls += calls.length;
    return { status: 200, body: JSON.stringify(calls.map((call, i) => ({ jsonrpc: "2.0", id: call.id,
      result: calls.length === 2 && call.method === "eth_call" ? i === 0 ? `0x${"0".repeat(63)}1` : f.bound.binding.sponsorAuth.sponsorHash : "0x1" }))) };
  } };
  const budget = new UsdtCommandReadBudget(f.state, transport, () => f.f.now().getTime(), async ms => { f.f.advance(ms); });
  const snapshot = f.f.prepare.safeSnapshot;
  f.f.prepare.safeSnapshot = async sender => {
    // Existing guard's two-batch shape; verified code material is supplied by this local test port.
    for (const methods of [["eth_chainId", "eth_getBlockByNumber"], Array.from({ length: 12 }, () => "eth_getCode")]) {
      await budget.request("https://rpc.test/", "POST", JSON.stringify(methods.map((method, i) => ({ jsonrpc: "2.0", id: String(i + 1), method, params: [] }))), 1024, "APN_RPC_CONFIG");
    }
    return await snapshot(sender);
  };
  f.f.prepare.sponsorPermit = async (bound, identity, safe) => await mintUsdtSponsorPermit({ bound, identity, snapshot: safe,
    transport: budget, rpcUrl: "https://rpc.test/", clock: { now: f.f.now } });
  const execute = new GaslessUsdtCommandExecute(f.state, { now: f.f.now }, f.wrapping,
    { preparePort: f.f.prepare, signer: f.signer, approval: { approve: async () => {} }, sendTransport: { send: async op => { sends++; return usdtUserOperationHash(op); } } });
  const result = await execute.execute(f.bound.profileHash, f.bound.operationId);
  assert.equal(result.state, "submitted_pending"); assert.equal(budget.count(), 7); assert.equal(physicalFakePosts, 7);
  assert.equal(logicalCalls, 44); assert.equal(sends, 1); assert.equal(f.wrapping.loads, 1);
});

test("policy revocation during fresh sponsor authentication fences before custody and releases allocated hold", async t => {
  const f = await setup(); t.after(f.temporary.cleanup); let sends = 0;
  const mint = f.f.prepare.sponsorPermit!;
  f.f.prepare.sponsorPermit = async (...args) => { const permit = await mint(...args); f.f.state.current = null; return permit; };
  const execute = new GaslessUsdtCommandExecute(f.state, { now: f.f.now }, f.wrapping,
    { preparePort: f.f.prepare, signer: f.signer, approval: { approve: async () => {} }, sendTransport: { send: async op => { sends++; return usdtUserOperationHash(op); } } });
  await assert.rejects(execute.execute(f.bound.profileHash, f.bound.operationId), /policy_changed/u);
  assert.equal(sends, 0); assert.equal(f.wrapping.loads, 0);
  assert.equal((await execute.status(f.bound.profileHash, f.bound.operationId)).execution?.state, "failed_before_effect");
});
