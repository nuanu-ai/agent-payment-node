import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { approvalCode } from "../../src/approval-code.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { OP_STACK_GAS_ORACLE } from "../../src/evm-direct-reads.js";
import { StateStore } from "../../src/state.js";
import { executeStargateV2Token, FileStargateTokenJournal, prepareStargateV2Token, type StargateTokenOperation } from "../../src/stargate-v2/token-execution.js";
import { unsignedEnvelopeBytes } from "../../src/stargate-v2/token-op-fees.js";
import { TtyStargateTokenApproval } from "../../src/stargate-v2/token-tty.js";
import { temporaryState } from "./helpers.js";
import { AMOUNT, BLOCK, FEE, L1_FEE, asV5TokenFixture, operatorFee, request, seedTokenFixture, setup } from "./stargate-token-support.js";

/**
 * F3: OP Mainnet charges each transaction an L1 data fee and an operator fee that gas x max fee per gas does not bound.
 * Their GasPriceOracle upper bounds are part of the owner's native debit cap at every check before a signature.
 */
const APPROVAL_GAS = 100_000n, BRIDGE_GAS = 100_000n, MAX_GAS = 5_000_000n;
const fee = (gas: bigint) => L1_FEE + operatorFee(gas);
const blocked = (reason: string, check?: (details: Record<string, unknown>) => void) => (error: any) => {
  assert.equal(error.details?.reason, reason); check?.(error.details); return true; };
const asV5 = asV5TokenFixture;

test("prepare stores both envelopes' bounds read at the quote block and spends them before the staged gas ceiling", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const journal = new FileStargateTokenJournal(temporary.root, state), s = setup(), cap = 402_910n;
  const op = await prepareStargateV2Token(request({ idempotencyKey: "op-fees-staged", maxNativeDebitAtomic: cap.toString() }), s.ports, journal);
  assert.equal(op.schemaVersion, "apn.stargate-v2-token-operation.v6");
  // The staged bridge is bounded at the protocol gas maximum, the most it can ever be signed with.
  const total = fee(APPROVAL_GAS) + fee(MAX_GAS), staged = (cap - APPROVAL_GAS * 2n - FEE - total) / 2n;
  assert.deepEqual(op.opStackFees, { oracle: OP_STACK_GAS_ORACLE, block: op.quote.block,
    approval: { unsignedBytesAtomic: unsignedEnvelopeBytes(op.approvalEnvelope!).toString(), gasAtomic: APPROVAL_GAS.toString(),
      l1DataFeeUpperWei: L1_FEE.toString(), operatorFeeUpperWei: operatorFee(APPROVAL_GAS).toString() },
    bridge: { unsignedBytesAtomic: unsignedEnvelopeBytes({ ...op.sendEnvelope, gasLimitAtomic: MAX_GAS.toString() }).toString(), gasAtomic: MAX_GAS.toString(),
      l1DataFeeUpperWei: L1_FEE.toString(), operatorFeeUpperWei: operatorFee(MAX_GAS).toString() }, totalUpperWei: total.toString() });
  assert.equal(op.sendEnvelope.gasLimitAtomic, staged.toString());
  assert.equal(op.maximumDebitAtomic, (APPROVAL_GAS * 2n + FEE + staged * 2n + total).toString()); assert.ok(BigInt(op.maximumDebitAtomic) <= cap);
  assert.equal(s.oracleReads().length, 4);
  for (const read of s.oracleReads()) assert.deepEqual(read.at, { blockHash: BLOCK, requireCanonical: true });
  assert.deepEqual(await journal.load(op.operationId), op); assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 0 });
});

test("a cap that admits value plus gas but not the L1 data and operator fees is refused before any signature", async () => {
  // Existing allowance: value 1000 + gas 100000 x 2 = 201000 fits the old check exactly; its fees push it past.
  const exact = setup({ allowance: AMOUNT });
  await assert.rejects(prepareStargateV2Token(request({ idempotencyKey: "op-fees-exact-tight", maxNativeDebitAtomic: (FEE + BRIDGE_GAS * 2n).toString() }), exact.ports, exact.journal),
    blocked("max_native_debit_exceeded", details => { assert.equal(details.required_wei, (FEE + BRIDGE_GAS * 2n + fee(BRIDGE_GAS)).toString());
      assert.equal(details.op_stack_fee_upper_wei, fee(BRIDGE_GAS).toString()); }));
  assert.equal(exact.journal.value, null); assert.deepEqual(exact.counts(), { sends: 0, signs: 0, approvals: 0 });
  // Approval path: approval gas + value + 2 left one wei-priced gas unit for the bridge before; the fees leave none.
  const staged = setup();
  await assert.rejects(prepareStargateV2Token(request({ idempotencyKey: "op-fees-staged-tight", maxNativeDebitAtomic: (APPROVAL_GAS * 2n + FEE + 2n).toString() }), staged.ports, staged.journal),
    blocked("max_native_debit_exceeded", details => assert.equal(details.op_stack_fee_upper_wei, (fee(APPROVAL_GAS) + fee(MAX_GAS)).toString())));
  assert.equal(staged.journal.value, null); assert.deepEqual(staged.counts(), { sends: 0, signs: 0, approvals: 0 });
  // The same cap raised by exactly the fees admits the operation, and it completes.
  const fits = setup({ allowance: AMOUNT }), cap = FEE + BRIDGE_GAS * 2n + fee(BRIDGE_GAS);
  const op = await prepareStargateV2Token(request({ idempotencyKey: "op-fees-exact-fits", maxNativeDebitAtomic: cap.toString() }), fits.ports, fits.journal);
  assert.equal(op.maximumDebitAtomic, cap.toString()); assert.equal((await executeStargateV2Token(op.operationId, fits.ports, fits.journal)).phase, "observed");
});

test("fresh bounds past the cap refuse at each later check before its signature", async () => {
  const cap = 402_910n, tight = (key: string) => request({ idempotencyKey: key, maxNativeDebitAtomic: cap.toString() });
  // Before the approval: both fresh bounds (bridge at its frozen gas) no longer fit; nothing is signed.
  const before = setup(), first = await prepareStargateV2Token(tight("op-fees-before-approval"), before.ports, before.journal); before.setL1Fee(1_000n);
  await assert.rejects(executeStargateV2Token(first.operationId, before.ports, before.journal), (e: any) => e.code === "APN_REPREPARE_REQUIRED" && e.details.reason === "recomputed_native_debit");
  assert.equal(before.journal.value?.phase, "approved"); assert.deepEqual(before.counts(), { sends: 0, signs: 0, approvals: 1 });
  // After the approval: the bridge's fresh bound plus the approval's stored one no longer fit; the allowance goes to cleanup.
  const after = setup({ l1FeeAfterApproval: 2_000n }), second = await prepareStargateV2Token(tight("op-fees-after-approval"), after.ports, after.journal);
  const required = await executeStargateV2Token(second.operationId, after.ports, after.journal);
  assert.equal(required.phase, "cleanup_required"); assert.equal(required.cleanupReason, "post_approval_quote_post_approval_max_native_debit");
  assert.equal(required.postApprovalQuote, undefined); assert.deepEqual(after.counts(), { sends: 1, signs: 1, approvals: 1 });
  // Existing allowance, before the send: one wei more of L1 fee is refused and the bridge is never signed.
  const send = setup({ allowance: AMOUNT }), third = await prepareStargateV2Token(request({ idempotencyKey: "op-fees-before-send",
    maxNativeDebitAtomic: (FEE + BRIDGE_GAS * 2n + fee(BRIDGE_GAS)).toString() }), send.ports, send.journal); send.setL1Fee(L1_FEE + 1n);
  const closed = await executeStargateV2Token(third.operationId, send.ports, send.journal);
  assert.equal(closed.phase, "cleanup_required"); assert.equal(closed.cleanupReason, "recomputed_native_debit"); assert.equal(send.counts().signs, 0);
});

test("the post-approval quote binds the bridge's fresh bounds and the approval keeps its prepare bounds", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const journal = new FileStargateTokenJournal(temporary.root, state), s = setup({ l1FeeAfterApproval: 800n });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "op-fees-post-approval" }), s.ports, journal);
  const observed = await executeStargateV2Token(prepared.operationId, s.ports, journal), post = observed.postApprovalQuote!;
  assert.equal(observed.phase, "observed"); assert.equal(post.schemaVersion, "apn.stargate-v2-token-post-approval-quote.v2");
  assert.deepEqual(post.opStackFees?.block, post.quoteBlock); assert.equal(post.opStackFees?.approval, undefined);
  assert.equal(post.opStackFees?.bridge.l1DataFeeUpperWei, "800"); assert.equal(post.opStackFees?.bridge.gasAtomic, post.sendEnvelope.gasLimitAtomic);
  const gas = (e: { gasLimitAtomic: string; maxFeePerGasAtomic: string }) => BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic);
  assert.equal(post.maximumDebitAtomic, (gas(observed.approvalEnvelope!) + fee(APPROVAL_GAS) + BigInt(post.sendEnvelope.valueAtomic) +
    gas(post.sendEnvelope) + 800n + operatorFee(BigInt(post.sendEnvelope.gasLimitAtomic))).toString());
});

test("an oracle read that fails or answers nothing refuses prepare; no zero is assumed", async () => {
  for (const [failure, check] of [["error", (e: any) => /oracle read failed/u.test(e.message)],
    ["empty", (e: any) => e.code === "APN_RPC_PROTOCOL" && e.details.reason === "op_stack_fee_oracle"]] as const) {
    const s = setup({ allowance: AMOUNT, oracleFailure: failure });
    await assert.rejects(prepareStargateV2Token(request({ idempotencyKey: `op-fees-oracle-${failure}` }), s.ports, s.journal), check);
    assert.equal(s.journal.value, null);
  }
});

test("the journal binds the stored bounds to their envelopes, block and total", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const s = setup(), op = await prepareStargateV2Token(request({ idempotencyKey: "op-fees-binding" }), s.ports, s.journal), f = op.opStackFees!;
  for (const opStackFees of [{ ...f, totalUpperWei: "0" }, { ...f, block: { ...f.block, numberAtomic: "1" } },
    { ...f, bridge: { ...f.bridge, gasAtomic: "1" } }, { ...f, approval: { ...f.approval!, unsignedBytesAtomic: "1" } }]) {
    const { integrityHash: _integrity, ...body } = { ...op, opStackFees }; await seedTokenFixture(temporary.root, { ...body, integrityHash: hashObject(body) } as StargateTokenOperation);
    await assert.rejects(new FileStargateTokenJournal(temporary.root, state).load(op.operationId), (e: any) => e.code === "APN_STATE_CORRUPT" && e.details.reason === "op_stack_fee_binding");
  }
});

test("the owner's consent names each bound and what the cap covers", async () => {
  const s = setup(), op = await prepareStargateV2Token(request({ idempotencyKey: "op-fees-consent" }), s.ports, s.journal);
  let printed = ""; const phrase = approvalCode("bridge", op.integrityHash);
  await new TtyStargateTokenApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 1, write: async (value: string) => { printed += value; },
    read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => {} }) }).approve(op);
  assert.match(printed, new RegExp(`approval ${L1_FEE} \\+ ${operatorFee(APPROVAL_GAS)} wei ETH`, "u"));
  assert.match(printed, new RegExp(`bridge ${L1_FEE} \\+ ${operatorFee(MAX_GAS)} wei ETH \\(for \\d+ unsigned bytes and ${MAX_GAS} gas\\)`, "u"));
  assert.match(printed, new RegExp(`total ${fee(APPROVAL_GAS) + fee(MAX_GAS)} wei ETH`, "u"));
  assert.match(printed, /It covers the LayerZero message value, each transaction's gas limit at the approved max fee per gas, and each transaction's OP Mainnet L1 data and operator fee upper bounds/u);
});

test("v5 records stay readable as written but sign no new approval or bridge", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const journal = new FileStargateTokenJournal(temporary.root, state);
  const golden = await readFile(join("tests", "fixtures", "operation-commands", "stargate-token.json"), "utf8"), record = JSON.parse(golden) as StargateTokenOperation;
  await seedTokenFixture(temporary.root, record); assert.equal(canonicalJson(await journal.load(record.operationId)), canonicalJson(record));
  // Before any effect: refused without the consent screen; the owner prepares again.
  const s = setup(), v5 = asV5(await prepareStargateV2Token(request({ idempotencyKey: "op-fees-v5-prepared" }), s.ports, s.journal));
  await seedTokenFixture(temporary.root, v5); assert.deepEqual(await journal.load(v5.operationId), v5); s.journal.value = v5;
  await assert.rejects(executeStargateV2Token(v5.operationId, s.ports, s.journal), (e: any) => e.code === "APN_REPREPARE_REQUIRED" && e.details.reason === "op_stack_fees_unbound_reprepare");
  assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 0 });
  // A landed approval: observed as before, then its allowance goes to the consented cleanup instead of a bridge.
  const a = setup({ approvalPendingPolls: 1 }), pending = await prepareStargateV2Token(request({ idempotencyKey: "op-fees-v5-approved" }), a.ports, a.journal);
  assert.equal((await executeStargateV2Token(pending.operationId, a.ports, a.journal)).phase, "allowance_unknown_finality"); a.journal.value = asV5(a.journal.value!);
  const required = await executeStargateV2Token(pending.operationId, a.ports, a.journal);
  assert.equal(required.schemaVersion, "apn.stargate-v2-token-operation.v5"); assert.equal(required.phase, "cleanup_required");
  assert.equal(required.cleanupReason, "op_stack_fees_unbound_reprepare"); assert.equal(required.postApprovalQuote, undefined);
  assert.deepEqual(a.counts(), { sends: 1, signs: 1, approvals: 1 });
});

test("M1: an existing-allowance bridge whose prepare quote expires while signing is never marked or sent", async () => {
  const s = setup({ allowance: AMOUNT }), prepared = await prepareStargateV2Token(request({ idempotencyKey: "m1-expiry-before-marker", ttlMs: 15_000 }), s.ports, s.journal);
  // The custody lock or ledger wait is modelled by a signer that returns after the prepare expiry.
  const ports = { ...s.ports, signer: { ...s.ports.signer, signTransaction: async (tx: Parameters<typeof s.ports.signer.signTransaction>[0]) => {
    s.advance(15_001); return await s.ports.signer.signTransaction(tx); } } };
  await assert.rejects(executeStargateV2Token(prepared.operationId, ports, s.journal), (e: any) => e.code === "APN_REPREPARE_REQUIRED" && e.details.reason === "expired_before_marker");
  const op = s.journal.value!; assert.equal(op.phase, "cleanup_required"); assert.equal(op.transactionHash, undefined); assert.equal(op.usageState, "failed_before_effect");
  assert.equal(op.cleanupReason, "expired_before_marker");
  assert.equal(s.journal.history.some(entry => entry.phase === "submission_started"), false); assert.equal(s.counts().sends, 0);
});
