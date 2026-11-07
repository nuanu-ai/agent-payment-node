import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { OP_STACK_GAS_ORACLE } from "../../src/evm-direct-reads.js";
import { StateStore } from "../../src/state.js";
import { executeStargateV2Token, FileStargateTokenJournal, prepareStargateV2Token, type StargateTokenExecutionPorts } from "../../src/stargate-v2/token-execution.js";
import { temporaryState } from "./helpers.js";
import { AMOUNT, FEE, L1_FEE, asV5TokenFixture, operatorFee, request, setup } from "./stargate-token-support.js";

/**
 * Review of 0.5.97: a sent approval is charged what it actually paid (or its larger known bound), a transient RPC
 * failure before the bridge never forces a paid revoke, and a hold whose bridge never left is released.
 */
const CAP = 402_910n, GAS = 100_000n, fee = (gas: bigint) => L1_FEE + operatorFee(gas);
const tight = (key: string) => request({ idempotencyKey: key, maxNativeDebitAtomic: CAP.toString() });
// The 0.5.97 charge (gas limit x max fee + prepare bound) admitted each of the bridges refused below.
const oldCharge = GAS * 2n + fee(GAS);
const hex = (value: bigint) => `0x${value.toString(16)}`;

test("a safe approval is charged its actual receipt fee: above its prepare bound the bridge that no longer fits is not signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const journal = new FileStargateTokenJournal(temporary.root, state);
  const s = setup({ approvalFeeFields: { gasUsed: hex(GAS), effectiveGasPrice: "0x2", l1Fee: hex(3_000n) } });
  const prepared = await prepareStargateV2Token(tight("charge-actual-above"), s.ports, journal);
  assert.ok(oldCharge + FEE + GAS * 2n + fee(GAS) <= CAP);
  const required = await executeStargateV2Token(prepared.operationId, s.ports, journal);
  assert.equal(required.phase, "cleanup_required"); assert.equal(required.cleanupReason, "post_approval_quote_post_approval_max_native_debit");
  assert.equal(required.approvalActualFee?.complete, true); assert.equal(required.approvalActualFee?.totalFeeAtomic, (GAS * 2n + 3_000n).toString());
  assert.deepEqual(s.counts(), { sends: 1, signs: 1, approvals: 1 }); assert.deepEqual(await journal.load(prepared.operationId), required);
});

test("an actual approval fee below its bound leaves the bridge the room it really has", async () => {
  const s = setup({ approvalFeeFields: { gasUsed: hex(50_000n), effectiveGasPrice: "0x1", l1Fee: hex(500n) }, l1FeeAfterApproval: 2_000n });
  const prepared = await prepareStargateV2Token(tight("charge-actual-below"), s.ports, s.journal);
  assert.ok(oldCharge + FEE + GAS * 2n + 2_000n + operatorFee(GAS) > CAP);
  const observed = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(observed.phase, "observed"); assert.equal(observed.postApprovalQuote?.maximumDebitAtomic, (50_500n + FEE + GAS * 2n + 2_000n + operatorFee(GAS)).toString());
});

test("without receipt fee fields the approval is charged the larger of its prepare and approval-marker bounds", async () => {
  const s = setup({ l1FeeAfterApproval: 1_100n }), prepared = await prepareStargateV2Token(tight("charge-marker-bound"), s.ports, s.journal);
  s.setL1Fee(940n); // L1 prices rose before the approval: the before-approval check admits, and the marker keeps, 940 + 10.
  assert.ok(oldCharge + FEE + GAS * 2n + 1_100n + operatorFee(GAS) <= CAP);
  const required = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(required.submissionOpStackFees?.approval?.l1DataFeeUpperWei, "940"); assert.equal(required.approvalActualFee, undefined);
  assert.equal(required.phase, "cleanup_required"); assert.equal(required.cleanupReason, "post_approval_quote_post_approval_max_native_debit");
  assert.deepEqual(s.counts(), { sends: 1, signs: 1, approvals: 1 });
});

/** Ports whose next oracle read fails once with `error`, armed by the test or by the first broadcast. */
function flaky(s: ReturnType<typeof setup>, error: ApnError, armOnSend = false) {
  let armed = false;
  const ports: StargateTokenExecutionPorts = { ...s.ports,
    sourceCall: async (method, params) => {
      if (armed && method === "eth_call" && (params[0] as { to?: string }).to === OP_STACK_GAS_ORACLE) { armed = false; throw error; }
      return await s.ports.sourceCall(method, params); },
    sendRawTransaction: async raw => { if (armOnSend && s.counts().sends === 0) armed = true; return await s.ports.sendRawTransaction(raw); } };
  return { ports, arm: () => { armed = true; } };
}

test("an unavailable RPC before the bridge keeps the phase, and the next execute retries without a revoke", async () => {
  const limited = new ApnError("APN_RPC_RATE_LIMITED", "Stargate RPC answered HTTP 429.", { reason: "rpc_status", httpStatus: 429 });
  const exact = setup({ allowance: AMOUNT }), first = await prepareStargateV2Token(request({ idempotencyKey: "transient-before-send" }), exact.ports, exact.journal);
  const a = flaky(exact, limited); a.arm();
  await assert.rejects(executeStargateV2Token(first.operationId, a.ports, exact.journal), (e: unknown) => e === limited);
  assert.equal(exact.journal.value?.phase, "approved"); assert.equal(exact.journal.value?.cleanupReason, undefined); assert.equal(exact.counts().sends, 0);
  assert.equal((await executeStargateV2Token(first.operationId, a.ports, exact.journal)).phase, "observed"); assert.equal(exact.counts().sends, 1);
  // After a paid approval, an RPC error result while the post-approval quote reads the oracle is not a reason to revoke.
  const result = new ApnError("APN_RPC_CONFIG", "Stargate token runtime unavailable: rpc_result.", { reason: "rpc_result" });
  const staged = setup(), second = await prepareStargateV2Token(request({ idempotencyKey: "transient-post-approval" }), staged.ports, staged.journal);
  const b = flaky(staged, result, true);
  await assert.rejects(executeStargateV2Token(second.operationId, b.ports, staged.journal), (e: unknown) => e === result);
  assert.equal(staged.journal.value?.phase, "allowance_observed"); assert.equal(staged.journal.value?.postApprovalQuote, undefined);
  const observed = await executeStargateV2Token(second.operationId, b.ports, staged.journal);
  assert.equal(observed.phase, "observed"); assert.deepEqual(staged.counts(), { sends: 2, signs: 2, approvals: 1 });
});

test("a reserved hold whose bridge was never marked is released on expiry and on a v5 record", async () => {
  for (const v5 of [false, true]) {
    // A crash at the send marker leaves `approved` holding a reserved usage hold with nothing sent.
    const s = setup({ allowance: AMOUNT, saveErrorPhaseOnce: "submission_started" });
    const prepared = await prepareStargateV2Token(request({ idempotencyKey: `hold-release-${v5}`, ttlMs: 15_000 }), s.ports, s.journal);
    await assert.rejects(executeStargateV2Token(prepared.operationId, s.ports, s.journal), /journal crash/u);
    assert.equal(s.journal.value?.phase, "approved"); assert.equal(s.journal.value?.usageState, "reserved");
    if (v5) s.journal.value = asV5TokenFixture(s.journal.value!); else s.advance(15_001);
    const reason = v5 ? "op_stack_fees_unbound_reprepare" : "expired";
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(executeStargateV2Token(prepared.operationId, s.ports, s.journal), (e: any) => e.code === "APN_REPREPARE_REQUIRED" && e.details.reason === reason);
      assert.equal(s.journal.value?.usageState, "failed_before_effect"); assert.equal(s.journal.value?.usageTarget, undefined);
    }
    assert.equal(s.counts().sends, 0);
  }
});
