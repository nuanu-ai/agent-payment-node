import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { assertGaslessEstimate, gaslessCalibratedGas, gaslessFee, gaslessGas, validateGaslessStoredOffer } from "../../src/gasless/economics.js";
import type { GaslessChainId, GaslessEstimate, GaslessGas, GaslessIntent } from "../../src/gasless/model.js";
import type { GaslessUserOperationMaterial } from "../../src/gasless/ports.js";
import { bundlerGasPrices } from "../../src/gasless/rpc-gas-prices.js";
import { GASLESS_ESTIMATE_SIGNATURE } from "../../src/gasless/signature.js";
import { transitionGasless } from "../../src/gasless/transitions.js";
import { gaslessSignedFees, gaslessUserOperation, validateGaslessWire } from "../../src/gasless/wire.js";
import { OperationService } from "../../src/operation-service.js";
import { bundledGaslessFixture } from "./gasless-fixtures/bundler-transport.js";
import { GaslessTestRpc, gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const NOW = new Date("2026-09-15T13:00:00.000Z");
const snapshot = (chainId: GaslessChainId, delegation: "empty" | "expected" = "empty") =>
  new GaslessTestRpc(chainId, privateKeyToAccount(generatePrivateKey()).address, delegation, NOW).current;
const fits = (gas: GaslessGas, delegation: "empty" | "expected", estimate: Omit<GaslessEstimate, "responseHash">) => {
  const intent = { gas, initialSnapshot: { delegation } } as unknown as GaslessIntent;
  assertGaslessEstimate(intent, { ...estimate, responseHash: hashObject(estimate) });
};
const total = (gas: GaslessGas) => ["verificationGasLimit", "callGasLimit", "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit", "preVerificationGas"].reduce((sum, field) => sum + BigInt(gas[field as keyof GaslessGas]), 0n);

// 2026-09-15 mirror estimates of the exact first-use UserOperation through the public Pimlico bundler.
const POLYGON_MIRROR = { verificationGasLimit: "61585", callGasLimit: "95736", paymasterVerificationGasLimit: "576312",
  paymasterPostOpGasLimit: "11360", preVerificationGas: "81822" };
const ETHEREUM_MIRROR = { verificationGasLimit: "61585", callGasLimit: "84248", paymasterVerificationGasLimit: "400530",
  paymasterPostOpGasLimit: "11360", preVerificationGas: "81835" };

test("the calibrated Polygon offer fits the measured Circle paymaster estimate that the v3 offer refused", () => {
  const polygon = snapshot(137), v3 = gaslessGas(polygon), v4 = gaslessCalibratedGas(polygon);
  assert.throws(() => fits(v3, "empty", POLYGON_MIRROR), /gasless_estimate_bounds/u);
  fits(v4, "empty", POLYGON_MIRROR);
  assert.ok(BigInt(v4.paymasterVerificationGasLimit) >= 576_312n * 12n / 10n);
  assert.ok(total(v4) <= 1_100_000n);
  assert.equal(v4.maxFeePerGas, v3.maxFeePerGas); assert.equal(v4.maxPriorityFeePerGas, v3.maxPriorityFeePerGas);
});

test("the calibrated Ethereum offer fits its mirror estimate with a smaller frozen gas total", () => {
  const ethereum = snapshot(1), v3 = gaslessGas(ethereum), v4 = gaslessCalibratedGas(ethereum);
  fits(v4, "empty", ETHEREUM_MIRROR);
  assert.ok(total(v4) < total(v3));
  const repeated = gaslessCalibratedGas(snapshot(1, "expected"));
  assert.equal(repeated.preVerificationGas, "125000");
});

test("chains without a calibration keep the v3 offer, and stored offers are recognized only for their wire version", () => {
  for (const chainId of [8453, 42161, 10, 130] as const) {
    const s = snapshot(chainId);
    assert.deepEqual(gaslessCalibratedGas(s), gaslessGas(s));
  }
  const polygon = snapshot(137), v3 = gaslessGas(polygon), v4 = gaslessCalibratedGas(polygon);
  validateGaslessStoredOffer(v4, polygon, "apn.gasless-wire.v4");
  validateGaslessStoredOffer(v3, polygon, "apn.gasless-wire.v3");
  validateGaslessStoredOffer(v3, polygon, undefined);
  assert.throws(() => validateGaslessStoredOffer(v3, polygon, "apn.gasless-wire.v4"), /gasless_fee_budget/u);
  assert.throws(() => validateGaslessStoredOffer(v4, polygon, "apn.gasless-wire.v3"), /gasless_fee_budget/u);
});

test("the frozen priority carries twice the fast tier, so the guard tolerates tier moves below that headroom", () => {
  const tier = (maximum: bigint, priority: bigint) => ({ maxFeePerGas: `0x${maximum.toString(16)}`, maxPriorityFeePerGas: `0x${priority.toString(16)}` });
  const quote = (slowMaximum: bigint, slowPriority: bigint) => ({ slow: tier(slowMaximum, slowPriority),
    standard: tier(slowMaximum > 145n ? slowMaximum : 145n, slowPriority > 95n ? slowPriority : 95n),
    fast: tier(slowMaximum > 150n ? slowMaximum : 150n, slowPriority > 100n ? slowPriority : 100n) });
  const frozen = bundlerGasPrices(quote(140n, 90n), "0xa", "0x1");
  assert.deepEqual(frozen, { baseFeePerGas: "10", maxFeePerGas: "220", maxPriorityFeePerGas: "200" });
  const approved = { maxFeePerGas: frozen.maxFeePerGas, maxPriorityFeePerGas: frozen.maxPriorityFeePerGas } as GaslessGas;
  bundlerGasPrices(quote(219n, 199n), "0xa", "0x1", approved);
  assert.throws(() => bundlerGasPrices(quote(219n, 201n), "0xa", "0x1", approved), /gasless_bundler_fee_drift/u);
  assert.throws(() => bundlerGasPrices(quote(221n, 199n), "0xa", "0x1", approved), /gasless_bundler_fee_drift/u);
});

for (const [result, reason] of [["misfit", "gasless_mirror_estimate_bounds"], ["unavailable", "gasless_mirror_estimate_unavailable"]] as const) {
  test(`a mirror estimate ${result} ends the operation before the approval screen, any signature or any disclosure`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
    s.rpc.mirrorResult = result;
    const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(response.ok, true, response.error?.message);
    const stored = await s.record(id);
    assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.failure, reason);
    assert.equal(stored.bootstrap.signingAttempts, 0); assert.equal(stored.bootstrap.disclosureAttempts, 0);
    assert.equal(s.approval.calls.length, 0); assert.equal(s.wrapping.loads, 0);
    assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
    await new OperationService(s.state).assertProfileAvailable(stored.profileHash);
  });
}

test("an approved transfer runs one mirror estimate before the screen and before the owner's bootstrap is signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  assert.equal((await s.record(id)).state, "completed");
  const calls = s.rpc.calls;
  assert.equal(calls.filter((c) => c === "mirror_estimate").length, 1);
  assert.ok(calls.indexOf("mirror_estimate") < calls.indexOf("estimate"));
});

test("the real bundler request signs with a throwaway sender and overrides only that sender's USDC balance", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await bundledGaslessFixture(temporary.root), { operation } = await s.prepare();
  const loads = s.wrapping.loads;
  const estimate = await s.rpc.mirrorEstimate(operation.intent,
    { maxFeePerGas: operation.intent.gas.maxFeePerGas, maxPriorityFeePerGas: operation.intent.gas.maxPriorityFeePerGas });
  assert.match(estimate.responseHash, /^[a-f0-9]{64}$/u);
  const [wire, entryPoint, override] = s.estimates.at(-1)! as [Record<string, any>, string, Record<string, any>];
  assert.equal(entryPoint, operation.intent.entryPoint);
  assert.notEqual(wire.sender, operation.intent.owner.address);
  assert.equal(wire.eip7702Auth.address, operation.intent.delegate);
  assert.deepEqual(Object.keys(override), [operation.intent.token]);
  const diff = override[operation.intent.token].stateDiff as Record<string, string>;
  assert.equal(Object.keys(diff).length, 1);
  assert.equal(BigInt(Object.values(diff)[0]!), BigInt(operation.intent.request.grossAtomic));
  assert.equal(s.wrapping.loads, loads);
});

test("a quote whose fee headroom exceeds the owner's maximum fee is refused at prepare, never lowered to fit", async (t) => {
  const first = await temporaryState(); t.after(first.cleanup);
  const { operation } = await (await bundledGaslessFixture(first.root)).prepare();
  const { gas, initialSnapshot } = operation.intent, quote = BigInt(gaslessFee(gas, initialSnapshot.feeConfiguration));
  // The fixture's fast tier is 300000 priority over a 1000000 base, which 0.5.17 froze as 2300000 / 300000.
  assert.equal(gas.maxPriorityFeePerGas, "600000");
  const unpadded = BigInt(gaslessFee({ ...gas, maxFeePerGas: "2300000", maxPriorityFeePerGas: "300000" }, initialSnapshot.feeConfiguration));
  assert.ok(unpadded <= quote - 1n);
  const second = await temporaryState(); t.after(second.cleanup);
  const s = await bundledGaslessFixture(second.root);
  const response = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
    request: { ...s.request, maxFeeAtomic: (quote - 1n).toString() }, idempotencyKey: "bundler-headroom-refusal-0001" });
  assert.equal(response.ok, false); assert.equal(response.error?.code, "APN_FEE_BUDGET_EXCEEDED");
  assert.equal(s.estimates.length, 0); assert.equal(s.wrapping.loads, 0);
});

for (const result of ["misfit", "fit"] as const) {
  test(`an approved transfer resumed before its bootstrap signature runs the mirror estimate first (${result})`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root), { id, operation } = await s.prepare();
    // The process stopped after the approval was recorded and before the owner's bootstrap was signed.
    await s.core.gasless.records.persist(transitionGasless(operation, { state: "execution_pending", approval: {
      policy: "apn.gasless.foreground-approval.v1", fingerprint: operation.fingerprint, approvedAt: s.now.toISOString(),
      expiresAt: operation.intent.expiresAt } }, s.now.toISOString()));
    s.rpc.mirrorResult = result;
    const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(resumed.ok, true, resumed.error?.message);
    const stored = await s.record(id), calls = s.rpc.calls;
    assert.equal(calls.filter((c) => c === "mirror_estimate").length, 1);
    if (result === "misfit") {
      assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.failure, "gasless_mirror_estimate_bounds");
      assert.equal(stored.bootstrap.signingAttempts, 0); assert.equal(s.wrapping.loads, 0);
      assert.equal(calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
      await new OperationService(s.state).assertProfileAvailable(stored.profileHash);
    } else {
      assert.equal(stored.state, "completed");
      assert.ok(calls.indexOf("mirror_estimate") < calls.indexOf("estimate"));
    }
  });
}

test("a v4 UserOperation carries the fees chosen after approval, and earlier wires keep their prepared prices", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { operation } = await (await gaslessFixture(temporary.root, 8453, { delegation: "expected" })).prepare();
  const intent = operation.intent, bootstrap = { permitSignature: GASLESS_ESTIMATE_SIGNATURE, authorization: null };
  const fees = { maxFeePerGas: "2600000", maxPriorityFeePerGas: "600000" };
  assert.throws(() => gaslessUserOperation(intent, bootstrap, GASLESS_ESTIMATE_SIGNATURE), /gasless_protocol_identity/u);
  const wire = gaslessUserOperation(intent, bootstrap, GASLESS_ESTIMATE_SIGNATURE, fees);
  assert.equal(wire.maxFeePerGas, "0x27ac40"); assert.equal(wire.maxPriorityFeePerGas, "0x927c0");
  assert.deepEqual(validateGaslessWire(intent, wire), wire); assert.deepEqual(gaslessSignedFees(intent, wire), fees);
  assert.throws(() => gaslessUserOperation(intent, bootstrap, GASLESS_ESTIMATE_SIGNATURE,
    { maxFeePerGas: "600000", maxPriorityFeePerGas: "600001" }), /gasless_protocol_identity/u);
  assert.throws(() => validateGaslessWire(intent, { ...wire, maxFeePerGas: "0x027ac40" }), /gasless_protocol_identity/u);
  const v3 = { ...intent, wireVersion: "apn.gasless-wire.v3" as const };
  assert.deepEqual(gaslessSignedFees(v3, gaslessUserOperation(v3, bootstrap, GASLESS_ESTIMATE_SIGNATURE)),
    { maxFeePerGas: intent.gas.maxFeePerGas, maxPriorityFeePerGas: intent.gas.maxPriorityFeePerGas });
  assert.throws(() => gaslessUserOperation(v3, bootstrap, GASLESS_ESTIMATE_SIGNATURE, fees), /gasless_protocol_identity/u);
  assert.throws(() => validateGaslessWire(v3, wire), /gasless_protocol_identity/u);
});

test("an approval pause that moves bundler prices signs fresh fees within the owner's cap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id, operation } = await s.prepare();
  const confirm = s.approval.confirm.bind(s.approval);
  s.approval.confirm = async (input) => {
    const accepted = await confirm(input);
    s.rpc.current = { ...s.rpc.current, maxFeePerGas: "2600000", maxPriorityFeePerGas: "600000" };
    return accepted;
  };
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  assert.equal((await s.record(id)).state, "completed"); assert.equal(operation.intent.gas.maxFeePerGas, "2100000");
  const sent = s.rpc.sends[0] as GaslessUserOperationMaterial;
  assert.equal(sent.userOperation.maxFeePerGas, "0x27ac40"); assert.equal(sent.userOperation.maxPriorityFeePerGas, "0x927c0");
  assert.deepEqual(s.rpc.estimateFees, [{ maxFeePerGas: "2600000", maxPriorityFeePerGas: "600000" }]);
  // Only the send check compares signed fees with the bundler's slow tier; every earlier guard priced afresh.
  assert.deepEqual(s.rpc.approvedFees, [{ maxFeePerGas: "2600000", maxPriorityFeePerGas: "600000" }]);
});

test("a fresh quote above the owner's cap after approval ends before the bootstrap is signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const confirm = s.approval.confirm.bind(s.approval);
  s.approval.confirm = async (input) => {
    const accepted = await confirm(input);
    s.rpc.current = { ...s.rpc.current, baseFeePerGas: "100000000000", maxFeePerGas: "210000000000", maxPriorityFeePerGas: "10000000000" };
    return accepted;
  };
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  const stored = await s.record(id);
  assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.failure, "gasless_fee_budget");
  assert.equal(stored.bootstrap.signingAttempts, 0); assert.equal(s.wrapping.loads, 0);
  // A quote above the cap can fall back inside it, so 0.5.19 retries it to the end of the window before giving up.
  assert.equal(s.wait.waits.length, 17);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
  await new OperationService(s.state).assertProfileAvailable(stored.profileHash);
});

for (const [spike, state] of [[2, "completed"], [100, "unknown_finality"]] as const) {
  test(`after disclosure a ${spike === 2 ? "short bundler price spike is waited out" : "persistent price spike is bounded"}`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
    const estimate = s.rpc.estimate.bind(s.rpc);
    s.rpc.estimate = async (...args: Parameters<typeof estimate>) => { const result = await estimate(...args); s.rpc.drift = spike; return result; };
    const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(response.ok, true, response.error?.message);
    const stored = await s.record(id);
    assert.equal(stored.state, state); assert.equal(stored.bootstrap.disclosureAttempts, 1);
    if (spike === 2) {
      assert.deepEqual(s.wait.waits, [5000, 5000]); assert.equal(s.rpc.sends.length, 1);
    } else {
      assert.equal(stored.failure, "gasless_bundler_fee_drift"); assert.equal(s.wait.waits.length, 17);
      assert.equal(s.rpc.sends.length, 0); assert.equal(stored.userOperation.submissionAttempts, 0);
    }
  });
}
