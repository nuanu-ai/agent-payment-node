import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { ApnCore } from "../../src/core.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import type { GaslessObservation, GaslessObservationSource } from "../../src/gasless/model.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import { assertGaslessObservationSource, gaslessObservationSource } from "../../src/gasless/observation-source.js";
import type { GaslessObservationPort, GaslessObservationRpcFactory } from "../../src/gasless/ports.js";
import { gaslessReceipt, publicGaslessOperation } from "../../src/gasless/receipt.js";
import type { GaslessDependencies } from "../../src/gasless/service.js";
import { gaslessFixture, GaslessTestRpc, testWord } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const OBSERVATION_ENV = "APN_ETHEREUM_ARCHIVE_RPC_URL";
const ALTERNATE_ORIGIN = "https://archive.example";
const ALTERNATE_ENDPOINT_HASH = hashObject("https://archive.example/private-path-redacted");

class StaticObserver implements GaslessObservationPort {
  readonly calls: Array<{ intent: unknown; identity: unknown; cursor: unknown }> = [];
  result!: GaslessObservation;
  constructor(
    readonly chainId: 8453 | 1 = 8453,
    readonly rpcOrigin = ALTERNATE_ORIGIN,
    readonly rpcEndpointHash = ALTERNATE_ENDPOINT_HASH,
  ) {}
  async observe(intent: Parameters<GaslessObservationPort["observe"]>[0],
    identity: Parameters<GaslessObservationPort["observe"]>[1],
    cursor: Parameters<GaslessObservationPort["observe"]>[2]): Promise<GaslessObservation> {
    this.calls.push({ intent: structuredClone(intent), identity: structuredClone(identity), cursor: structuredClone(cursor) });
    return structuredClone(this.result);
  }
}

test("explicit alternate observer settles one submitted operation without any effect-capable access", async (t) => {
  const { fixture, id, before, safe } = await submittedFixture(t, "observation-source-settlement-0001");
  const observer = sourcedObserver(before, safe);
  const runtime = observationCore(fixture, (_chain, _environment) => observer);
  const original = {
    rpcCalls: fixture.rpc.calls.length,
    sends: fixture.rpc.sends.length,
    wrappingLoads: fixture.wrapping.loads,
  };

  const result = await runtime.core.execute({
    command: "operation.resume",
    operationId: id,
    observationRpcEnv: OBSERVATION_ENV,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = await fixture.record(id);
  assert.equal(after.state, "completed");
  assert.equal(after.terminal, true);
  for (const key of ["intent", "fingerprint", "approval", "bootstrap", "userOperation"] as const) {
    if (key === "userOperation") assert.deepEqual(after[key], { ...before[key], phase: "safe_success" });
    else assert.deepEqual(after[key], before[key]);
  }
  assert.deepEqual(after.transitions.slice(0, before.transitions.length), before.transitions);
  assert.deepEqual(after.observation?.source, gaslessObservationSource(before.intent, OBSERVATION_ENV, observer));
  assert.deepEqual((result.operation as { observation_source?: unknown }).observation_source, after.observation?.source);
  assert.equal(JSON.stringify(after.observation?.source).includes("private-path-redacted"), false);
  assert.equal(observer.calls.length, 1);
  assert.deepEqual(observer.calls[0], {
    intent: before.intent,
    identity: {
      bootstrapMaterialHash: before.bootstrap.materialHash,
      userOperationMaterialHash: before.userOperation.materialHash,
      userOperationHash: before.userOperation.userOperationHash,
    },
    cursor: before.cursor,
  });
  assert.deepEqual(runtime.effects, { rpc: 0, factory: 1, load: 0, seal: 0 });
  assert.deepEqual({ rpcCalls: fixture.rpc.calls.length, sends: fixture.rpc.sends.length,
    wrappingLoads: fixture.wrapping.loads }, original);

  const receiptResult = await runtime.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(receiptResult.ok, true, JSON.stringify(receiptResult));
  const receipt = receiptResult.receipt as { observation_source?: unknown; receipt_hash: string };
  assert.deepEqual(receipt.observation_source, after.observation?.source);
  const recordHash = hashObject(after), receiptHash = receipt.receipt_hash;

  const restart = observationCore(fixture, () => { throw new Error("terminal observer factory must not resolve"); });
  const repeated = await restart.core.execute({ command: "operation.resume", operationId: id,
    observationRpcEnv: "APN_MISSING_RPC_URL" });
  const status = await restart.core.execute({ command: "operation.status", operationId: id });
  const repeatedReceipt = await restart.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(repeatedReceipt.ok, true, JSON.stringify(repeatedReceipt));
  assert.deepEqual(restart.effects, { rpc: 0, factory: 0, load: 0, seal: 0 });
  assert.equal(hashObject(await fixture.record(id)), recordHash);
  assert.equal((repeatedReceipt.receipt as { receipt_hash: string }).receipt_hash, receiptHash);
});

test("explicit mode returns before observer resolution for pre-signing state and classifies a missing factory", async (t) => {
  await t.test("pre-signing no-op", async (child) => {
    const temporary = await temporaryState();
    child.after(temporary.cleanup);
    const fixture = await gaslessFixture(temporary.root);
    const { id } = await fixture.prepare("observation-source-pre-signing-0001");
    const before = await fixture.record(id);
    assert.equal(before.bootstrap.signingAttempts, 0);
    const runtime = observationCore(fixture, () => { throw new Error("pre-signing factory must not resolve"); });
    const result = await runtime.core.execute({ command: "operation.resume", operationId: id,
      observationRpcEnv: OBSERVATION_ENV });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(hashObject(await fixture.record(id)), hashObject(before));
    assert.deepEqual(runtime.effects, { rpc: 0, factory: 0, load: 0, seal: 0 });
  });

  await t.test("missing factory", async (child) => {
    const { fixture, id, before } = await submittedFixture(child, "observation-source-no-factory-0001");
    let rpcCalls = 0, custodyCalls = 0;
    const dependencies: GaslessDependencies = {
      rpcFor: () => { rpcCalls += 1; throw new Error("unexpected execution RPC"); },
      custody: {
        load: async () => { custodyCalls += 1; throw new Error("unexpected custody load"); },
        seal: async () => { custodyCalls += 1; throw new Error("unexpected custody seal"); },
      },
    };
    const core = new ApnCore({ state: fixture.state, gasless: dependencies,
      clock: { now: () => new Date(fixture.now) } });
    const result = await core.execute({ command: "operation.resume", operationId: id,
      observationRpcEnv: OBSERVATION_ENV });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "APN_RPC_CONFIG");
    assert.match(result.error?.message ?? "", /gasless_observation_rpc_unavailable/u);
    assert.equal(rpcCalls, 0);
    assert.equal(custodyCalls, 0);
    assert.equal(hashObject(await fixture.record(id)), hashObject(before));
  });
});

test("accepted non-terminal alternate observation retains the explicit source in next actions", async (t) => {
  const { fixture, id, before } = await submittedFixture(t, "observation-source-next-action-0001");
  const observer = new StaticObserver();
  observer.result = { ...before.observation!,
    source: gaslessObservationSource(before.intent, OBSERVATION_ENV, observer) };
  const runtime = observationCore(fixture, () => observer);
  const result = await runtime.core.execute({ command: "operation.resume", operationId: id,
    observationRpcEnv: OBSERVATION_ENV });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((result.operation as { state: string }).state, "submitted_pending");
  assert.deepEqual((result.operation as { observation_source: unknown }).observation_source, observer.result.source);
  assert.deepEqual((result.operation as { next_actions: string[] }).next_actions,
    [`apn operation resume --operation ${id} --observation-rpc-env ${OBSERVATION_ENV}`]);
  assert.deepEqual(runtime.effects, { rpc: 0, factory: 1, load: 0, seal: 0 });
});

test("explicit observer availability failure is visible once and preserves accepted progress without effects", async (t) => {
  const { fixture, id, before } = await submittedFixture(t, "observation-source-unavailable-0001");
  const observer = new StaticObserver();
  const previousEndBlock = { numberAtomic: before.cursor.nextBlockAtomic,
    hash: testWord("observation-progress"), timestampAtomic: before.intent.initialSnapshot.block.timestampAtomic };
  observer.result = { status: "not_found", transactionHash: null, settlement: null,
    cursor: { startBlock: before.cursor.startBlock,
      nextBlockAtomic: (BigInt(before.cursor.nextBlockAtomic) + 1n).toString(), previousEndBlock },
    evidenceHash: hashObject({ id, previousEndBlock }), reason: null,
    source: gaslessObservationSource(before.intent, OBSERVATION_ENV, observer) };
  const runtime = observationCore(fixture, () => observer);
  const progressed = await runtime.core.execute({ command: "operation.resume", operationId: id,
    observationRpcEnv: OBSERVATION_ENV });
  assert.equal(progressed.ok, true, JSON.stringify(progressed));
  const accepted = await fixture.record(id);
  assert.equal(accepted.cursor.nextBlockAtomic, observer.result.cursor.nextBlockAtomic);
  assert.deepEqual(accepted.observation, observer.result);
  assert.deepEqual(accepted.bootstrap, before.bootstrap);
  assert.deepEqual(accepted.userOperation, before.userOperation);

  observer.observe = async () => { throw new ApnError("APN_RPC_AMBIGUOUS", "redacted", {
    reason: "gasless_observation_rpc_unavailable", retryable: true,
  }); };
  const unavailable = await runtime.core.execute({ command: "operation.resume", operationId: id,
    observationRpcEnv: OBSERVATION_ENV });
  assert.equal(unavailable.ok, true, JSON.stringify(unavailable));
  assert.equal((unavailable.operation as { reason: string }).reason, "gasless_observation_rpc_unavailable");
  const failed = await fixture.record(id);
  assert.equal(failed.failure, "gasless_observation_rpc_unavailable");
  assert.deepEqual(failed.cursor, accepted.cursor);
  assert.deepEqual(failed.observation, accepted.observation);
  assert.deepEqual(failed.bootstrap, before.bootstrap);
  assert.deepEqual(failed.userOperation, before.userOperation);
  assert.equal(failed.transitions.length, accepted.transitions.length + 1);
  const failedHash = hashObject(failed), failedUpdatedAt = failed.updatedAt;

  const repeated = await runtime.core.execute({ command: "operation.resume", operationId: id,
    observationRpcEnv: OBSERVATION_ENV });
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  const unchanged = await fixture.record(id);
  assert.equal(hashObject(unchanged), failedHash);
  assert.equal(unchanged.updatedAt, failedUpdatedAt);
  assert.deepEqual(runtime.effects, { rpc: 0, factory: 3, load: 0, seal: 0 });
});

test("explicit alternate observer closes known bootstrap material without custody or execution RPC", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const fixture = await gaslessFixture(temporary.root);
  const { id } = await fixture.prepare("observation-source-bootstrap-0001");
  fixture.rpc.estimateFails = true;
  assert.equal((await fixture.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const before = await fixture.record(id);
  assert.equal(before.bootstrap.disclosureAttempts, 1);
  assert.equal(before.userOperation.signingAttempts, 0);
  const observer = new StaticObserver();
  observer.result = { ...permissionObservation(before),
    source: gaslessObservationSource(before.intent, OBSERVATION_ENV, observer) };
  const runtime = observationCore(fixture, () => observer);
  const original = { rpcCalls: fixture.rpc.calls.length, sends: fixture.rpc.sends.length,
    wrappingLoads: fixture.wrapping.loads };

  const result = await runtime.core.execute({ command: "operation.resume", operationId: id,
    observationRpcEnv: OBSERVATION_ENV });
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = await fixture.record(id);
  assert.equal(after.state, "failed_permissions_invalidated");
  assert.equal(after.terminal, true);
  assert.deepEqual(after.intent, before.intent);
  assert.deepEqual(after.bootstrap, before.bootstrap);
  assert.deepEqual(after.userOperation, before.userOperation);
  assert.deepEqual(after.transitions.slice(0, before.transitions.length), before.transitions);
  assert.deepEqual(runtime.effects, { rpc: 0, factory: 1, load: 0, seal: 0 });
  assert.deepEqual({ rpcCalls: fixture.rpc.calls.length, sends: fixture.rpc.sends.length,
    wrappingLoads: fixture.wrapping.loads }, original);
});

test("explicit recovery rejects wrong observer identity or returned provenance without releasing the guard", async (t) => {
  const mutations: Array<[string, (source: GaslessObservationSource) => void]> = [
    ["environment", (source) => { (source as { environmentName: string }).environmentName = "APN_OTHER_RPC_URL"; }],
    ["origin", (source) => { (source as { rpcOrigin: string }).rpcOrigin = "https://wrong.example"; }],
    ["endpoint hash", (source) => { (source as { rpcEndpointHash: string }).rpcEndpointHash = "f".repeat(64); }],
    ["intent hash", (source) => { (source as { intentHash: string }).intentHash = "f".repeat(64); }],
    ["anchor", (source) => { (source.initialBlock as { hash: string }).hash = testWord("wrong-anchor"); }],
    ["policy", (source) => { (source as { policy: string }).policy = "apn.gasless.observation-rpc.v0"; }],
    ["extra field", (source) => { (source as unknown as Record<string, unknown>).secret = "must-not-persist"; }],
  ];

  for (const [name, mutate] of mutations) await t.test(name, async (child) => {
    const { fixture, id, before, safe } = await submittedFixture(child, `observation-source-wrong-${name.replaceAll(" ", "-")}`);
    const observer = sourcedObserver(before, safe);
    const badSource = structuredClone(observer.result.source!);
    mutate(badSource);
    observer.result = { ...observer.result, source: badSource };
    const runtime = observationCore(fixture, () => observer);
    const result = await runtime.core.execute({ command: "operation.resume", operationId: id,
      observationRpcEnv: OBSERVATION_ENV });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await fixture.record(id);
    assert.equal(after.state, "unknown_finality");
    assert.equal(after.terminal, false);
    assert.equal(after.observation?.source, undefined);
    assert.deepEqual(after.intent, before.intent);
    assert.deepEqual(after.bootstrap, before.bootstrap);
    assert.deepEqual(after.userOperation, before.userOperation);
    assert.deepEqual(after.transitions.slice(0, before.transitions.length), before.transitions);
    assert.deepEqual(runtime.effects, { rpc: 0, factory: 1, load: 0, seal: 0 });
  });

  await t.test("chain", async (child) => {
    const { fixture, id, before } = await submittedFixture(child, "observation-source-wrong-chain");
    const observer = new StaticObserver(1);
    const runtime = observationCore(fixture, () => observer);
    const result = await runtime.core.execute({ command: "operation.resume", operationId: id,
      observationRpcEnv: OBSERVATION_ENV });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await fixture.record(id);
    assert.equal(after.state, "unknown_finality");
    assert.deepEqual(after.bootstrap, before.bootstrap);
    assert.deepEqual(after.userOperation, before.userOperation);
    assert.equal(observer.calls.length, 0);
    assert.deepEqual(runtime.effects, { rpc: 0, factory: 1, load: 0, seal: 0 });
  });
});

test("provenance binding rejects exact-schema faults and rehashed historical forgery", async (t) => {
  const { fixture, id, before, safe } = await submittedFixture(t, "observation-source-forgery-0001");
  const observer = sourcedObserver(before, safe);
  const valid = gaslessObservationSource(before.intent, OBSERVATION_ENV, observer);
  assert.doesNotThrow(() => assertGaslessObservationSource(before.intent, valid));
  for (const faulty of [
    { ...valid, intentHash: "f".repeat(64) },
    { ...valid, initialBlock: { ...valid.initialBlock, timestampAtomic: "0" } },
    { ...valid, extra: "forged" },
  ]) assert.throws(() => assertGaslessObservationSource(before.intent, faulty as GaslessObservationSource),
    { code: "APN_STATE_CORRUPT" });

  const runtime = observationCore(fixture, () => observer);
  assert.equal((await runtime.core.execute({ command: "operation.resume", operationId: id,
    observationRpcEnv: OBSERVATION_ENV })).ok, true);
  const accepted = await fixture.record(id);
  const forged = structuredClone(accepted) as GaslessOperationRecord;
  const mutable = forged as unknown as { observation: GaslessObservation };
  const transitions = forged.transitions as unknown as Array<Record<string, unknown>>;
  const final = transitions.at(-1)!;
  const finalObservation = final.observation as GaslessObservation;
  (mutable.observation.source as { intentHash: string }).intentHash = "f".repeat(64);
  (finalObservation.source as { intentHash: string }).intentHash = "f".repeat(64);
  const { transitionHash: _oldTransitionHash, ...transitionBody } = final;
  final.transitionHash = hashObject(transitionBody);
  const writable = forged as unknown as Record<string, unknown>;
  const { integrityHash: _oldIntegrityHash, ...operationBody } = writable;
  writable.integrityHash = hashObject(operationBody);
  const operationPath = resolve(temporaryRoot(fixture), "gasless-operations", accepted.profileHash, `${id}.json`);
  await writeFile(operationPath, `${canonicalJson(forged)}\n`, { mode: 0o600 });
  await assert.rejects(runtime.core.gasless.records.findOperation(id), { code: "APN_STATE_CORRUPT" });
});

test("ordinary recovery keeps original endpoint binding and legacy observations byte-stable", async (t) => {
  await t.test("endpoint mismatch", async (child) => {
    const { fixture, id, before } = await submittedFixture(child, "observation-source-ordinary-drift");
    const drift = new GaslessTestRpc(8453, before.intent.owner.address,
      before.intent.initialSnapshot.delegation, fixture.now);
    Object.defineProperty(drift, "rpcOrigin", { value: "https://drift.example" });
    Object.defineProperty(drift, "rpcEndpointHash", { value: hashObject("https://drift.example") });
    const core = new ApnCore({ state: fixture.state, gasless: { ...fixture.dependencies, rpcFor: () => drift },
      clock: { now: () => new Date(fixture.now) } });
    const result = await core.execute({ command: "operation.resume", operationId: id });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await fixture.record(id);
    assert.equal(after.state, "unknown_finality");
    assert.equal(after.observation?.source, undefined);
    assert.deepEqual(after.intent, before.intent);
    assert.deepEqual(after.bootstrap, before.bootstrap);
    assert.deepEqual(after.userOperation, before.userOperation);
    assert.deepEqual(drift.calls, []);
  });

  await t.test("returned explicit source", async (child) => {
    const { fixture, id, before, safe } = await submittedFixture(child, "observation-source-ordinary-sourced");
    const ordinarySource = gaslessObservationSource(before.intent, OBSERVATION_ENV, fixture.rpc);
    fixture.rpc.observe = async () => { fixture.rpc.calls.push("observe"); return { ...safe, source: ordinarySource }; };
    const sends = fixture.rpc.sends.length, loads = fixture.wrapping.loads;
    const result = await fixture.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await fixture.record(id);
    assert.equal(after.state, "unknown_finality");
    assert.equal(after.observation?.source, undefined);
    assert.equal(fixture.rpc.sends.length, sends);
    assert.equal(fixture.wrapping.loads, loads);
    assert.deepEqual(after.bootstrap, before.bootstrap);
    assert.deepEqual(after.userOperation, before.userOperation);
  });

  await t.test("legacy omission", async (child) => {
    const temporary = await temporaryState();
    child.after(temporary.cleanup);
    const fixture = await gaslessFixture(temporary.root);
    const { id } = await fixture.prepare("observation-source-legacy-0001");
    assert.equal((await fixture.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    const operation = await fixture.record(id);
    assert.equal(operation.state, "completed");
    assert.equal(operation.observation?.source, undefined);
    const publicOperation = publicGaslessOperation(operation) as Record<string, unknown>;
    assert.equal(Object.hasOwn(publicOperation, "observation_source"), false);
    const receipt = gaslessReceipt(operation) as unknown as Record<string, unknown>;
    assert.equal(Object.hasOwn(receipt, "observation_source"), false);
    const { receipt_hash: receiptHash, ...body } = receipt;
    assert.equal(receiptHash, hashObject(body));
    assert.equal(canonicalJson(gaslessReceipt(await fixture.record(id))), canonicalJson(receipt));
  });
});

async function submittedFixture(t: TestContext, idempotencyKey: string) {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const fixture = await gaslessFixture(temporary.root);
  const { id } = await fixture.prepare(idempotencyKey);
  fixture.rpc.result = "pending";
  assert.equal((await fixture.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const before = await fixture.record(id);
  assert.equal(before.state, "submitted_pending");
  assert.equal(before.userOperation.submissionAttempts, 1);
  fixture.rpc.result = "safe";
  const safe = await fixture.rpc.observe(before.intent, {
    bootstrapMaterialHash: before.bootstrap.materialHash,
    userOperationMaterialHash: before.userOperation.materialHash,
    userOperationHash: before.userOperation.userOperationHash,
  }, before.cursor);
  assert.equal(safe.status, "safe");
  return { fixture, id, before, safe };
}

function sourcedObserver(op: GaslessOperationRecord, observation: GaslessObservation): StaticObserver {
  const observer = new StaticObserver();
  observer.result = { ...observation, source: gaslessObservationSource(op.intent, OBSERVATION_ENV, observer) };
  return observer;
}

function observationCore(fixture: Awaited<ReturnType<typeof gaslessFixture>>,
  factory: GaslessObservationRpcFactory) {
  const effects = { rpc: 0, factory: 0, load: 0, seal: 0 };
  const fail = (key: "rpc" | "load" | "seal"): never => {
    effects[key] += 1;
    throw new Error(`unexpected_${key}`);
  };
  const dependencies: GaslessDependencies = {
    rpcFor: () => fail("rpc"),
    observationRpcFor: (chainId, environmentName) => {
      effects.factory += 1;
      assert.equal(chainId, 8453);
      assert.equal(environmentName, OBSERVATION_ENV);
      return factory(chainId, environmentName);
    },
    custody: { load: async () => fail("load"), seal: async () => fail("seal") },
  };
  const core = new ApnCore({ state: fixture.state, gasless: dependencies,
    clock: { now: () => new Date(fixture.now) } });
  return { core, effects };
}

function permissionObservation(op: GaslessOperationRecord): GaslessObservation {
  const initial = op.intent.initialSnapshot;
  const nonce = (BigInt(initial.eoaNonceAtomic) + (initial.delegation === "empty" ? 1n : 0n)).toString();
  const account = { owner: initial.owner, balanceAtomic: initial.balanceAtomic,
    nativeBalanceWei: initial.nativeBalanceWei, allowanceAtomic: "0",
    permitNonceAtomic: (BigInt(initial.permitNonceAtomic) + 1n).toString(),
    entryPointNonceAtomic: initial.entryPointNonceAtomic, eoaNonceAtomic: nonce,
    pendingEoaNonceAtomic: nonce, delegation: initial.delegation };
  const proof = { chainId: initial.chainId, intentHash: hashObject(op.intent),
    bootstrapMaterialHash: op.bootstrap.materialHash!, protocolHash: initial.protocolHash,
    safeBlock: { numberAtomic: "101", hash: testWord("101"), timestampAtomic: initial.block.timestampAtomic },
    headBlock: { numberAtomic: "102", hash: testWord("102"), timestampAtomic: initial.block.timestampAtomic },
    safeAccount: account, headAccount: { ...account } };
  return { status: "permissions_invalidated", transactionHash: null, settlement: null,
    cursor: op.cursor, evidenceHash: hashObject(proof), reason: "gasless_bootstrap_permissions_invalidated",
    permissionInvalidation: proof };
}

function temporaryRoot(fixture: Awaited<ReturnType<typeof gaslessFixture>>): string {
  return fixture.state.root;
}
