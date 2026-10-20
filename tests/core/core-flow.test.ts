import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "../../src/model.js";
import { BASE_USDC } from "../../src/constants.js";
import { readEvmReceiptFeeFields } from "../../src/evm-direct-actual-fee.js";
import { activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";
import { CanonicalDirectTestNative as TestNative } from "./canonical-direct-native-fixture.js";
import {
  OTHER_RECIPIENT,
  RAW_TRANSACTION,
  RECIPIENT,
  TestClock,
  TestRpc,
  WALLET,
  activateBaseUsdcDirectPolicy,
  ensureWallet as ensureLegacyWallet,
  exactReceipt,
  makeCore as legacyMakeCore,
  prepareTransfer,
  temporaryState,
} from "./helpers.js";

// Real Native checks wall-clock approval expiry. Keep explicit historical-clock
// cases, and use the current clock for cases that enter the real TEST signer.
function makeCore(options: Parameters<typeof legacyMakeCore>[0]) {
  const clock = options.clock ?? new TestClock();
  if (options.clock === undefined) clock.value = new Date();
  return legacyMakeCore({ ...options, clock });
}


/** The local Base USDC transfer is gated by the owner's allowlist like every direct transfer. */
async function ensureWallet(core: ReturnType<typeof makeCore>): Promise<void> {
  await ensureLegacyWallet(core);
  await activateBaseUsdcDirectPolicy(core.context.state.root);
}

type Envelope = Awaited<ReturnType<ReturnType<typeof makeCore>["execute"]>>;

function operationRecord(envelope: Envelope): Record<string, unknown> {
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
  assert.equal(envelope.error, null);
  assert.notEqual(envelope.operation, null);
  return envelope.operation as Record<string, unknown>;
}

function dataRecord(envelope: Envelope): Record<string, unknown> {
  assert.equal(envelope.ok, true);
  assert.equal(envelope.error, null);
  assert.notEqual(envelope.data, null);
  return envelope.data as Record<string, unknown>;
}

test("wallet reconcile, restart-safe status, and safe labelled balance guidance", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const native = new TestNative(temporary.root);
  await ensureWallet(makeCore({ root: temporary.root, native }));

  const status = await makeCore({ root: temporary.root, native: new TestNative(temporary.root) }).execute({
    command: "wallet.status",
    profile: "default",
  });
  assert.equal(dataRecord(status).status, "ready");

  const balance = await makeCore({ root: temporary.root, rpc: new TestRpc() }).execute({
    command: "wallet.balance",
    profile: "default",
  });
  assert.equal(balance.version, "apn.cli.v1");
  assert.equal(balance.proof_class, "chain_verified_public_read");
  const output = dataRecord(balance);
  assert.equal(output.chain, "eip155:8453");
  assert.equal(output.funding_address, "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1");
  assert.match(String(output.explorer_url), /^https:\/\/basescan\.org\/address\//);
  assert.deepEqual(output.balances, {
    ETH: { atomic: "1000000000000000000", decimal: "1", decimals: 18 },
    USDC: {
      atomic: "50000000",
      decimal: "50",
      decimals: 6,
      contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
  });
  assert.deepEqual(output.provenance, {
    block_number_atomic: "12345",
    block_hash: `0x${"b".repeat(64)}`,
    observed_at: "2026-08-26T00:00:00.000Z",
    rpc_origin: "https://rpc.example",
  });
  assert.match(JSON.stringify(output.funding_guidance), /small amount|low|afford to lose/i);
});

test("duplicate prepare converges and changed input conflicts before RPC effect", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(temporary.root) }));
  const rpc = new TestRpc();
  const core = makeCore({ root: temporary.root, rpc });
  const request = {
    command: "transfer.prepare" as const,
    profile: "default",
    idempotencyKey: "payment-001",
    recipient: RECIPIENT,
    amount: "1.25",
  };
  const first = await core.execute(request);
  const calls = rpc.balanceCalls;
  const duplicate = await core.execute(request);
  assert.equal(operationRecord(first).operation_id, operationRecord(duplicate).operation_id);
  assert.equal(rpc.balanceCalls, calls);

  const conflict = await core.execute({ ...request, recipient: OTHER_RECIPIENT });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(rpc.balanceCalls, calls, "conflict must be detected before another RPC read");
  assert.equal(JSON.stringify(conflict).includes("payment-001"), false);
});

test("concurrent duplicate prepares serialize and perform one RPC preparation", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(temporary.root) }));
  const rpc = new TestRpc();
  const core = makeCore({ root: temporary.root, rpc });
  const request = {
    command: "transfer.prepare" as const,
    profile: "default",
    idempotencyKey: "concurrent-001",
    recipient: RECIPIENT,
    amount: "2",
  };
  const [a, b] = await Promise.all([core.execute(request), core.execute(request)]);
  assert.equal(operationRecord(a).operation_id, operationRecord(b).operation_id);
  assert.equal(rpc.balanceCalls, 1);
  assert.equal(rpc.nonceCalls, 1);
});

test("direct-transfer resume rejects x402 settlement wait without signing or submission", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const native = new TestNative(temporary.root);
  const rpc = new TestRpc();
  await ensureWallet(makeCore({ root: temporary.root, native }));
  const operationId = await prepareTransfer(makeCore({ root: temporary.root, rpc }), "direct-no-x402-wait");
  native.calls.length = 0;
  const result = await makeCore({ root: temporary.root, native, rpc }).execute({
    command: "operation.resume",
    operationId,
    waitSeconds: 1,
  });
  assert.equal(result.error?.code, "APN_INVALID_INPUT");
  assert.equal(native.calls.length, 0);
  assert.equal(rpc.submissions.length, 0);
});

test("prepared time is whole-second canonical even with a production-style millisecond clock", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(temporary.root) }));
  const clock = new TestClock();
  clock.value = new Date("2026-08-26T00:00:00.987Z");
  const prepared = await makeCore({ root: temporary.root, rpc: new TestRpc(), clock }).execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: "canonical-time-001",
    recipient: RECIPIENT,
    amount: "1.25",
  });
  const operation = operationRecord(prepared);
  assert.equal(operation.prepared_at, "2026-08-26T00:00:00.000Z");
  assert.equal(operation.expires_at, "2026-08-26T00:10:00.000Z");
});

test("gas shortage rejects prepare and fee drift durably requires reprepare before signing", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(temporary.root) }));

  const poorRpc = new TestRpc();
  poorRpc.balances = { ...poorRpc.balances, ethAtomic: "1" };
  const poor = await makeCore({ root: temporary.root, rpc: poorRpc }).execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: "poor-gas-001",
    recipient: RECIPIENT,
    amount: "1",
  });
  assert.equal(poor.ok, false);
  assert.equal(poor.error?.code, "APN_INSUFFICIENT_GAS");

  const rpc = new TestRpc();
  const operationId = await prepareTransfer(makeCore({ root: temporary.root, rpc }), "fee-drift-001");
  rpc.fees = { ...rpc.fees, maxFeePerGasAtomic: "2000000001" };
  const native = new TestNative(temporary.root);
  const drift = await makeCore({ root: temporary.root, rpc, native }).execute({
    command: "transfer.approve",
    operationId,
  });
  assert.equal(drift.ok, false);
  assert.equal(drift.error?.code, "APN_REPREPARE_REQUIRED");
  assert.match(drift.next_actions[0] ?? "", /^apn pay transfer prepare --profile default --idempotency-key retry-[0-9a-f]{16} /u);
  assert.equal(native.calls.length, 0, "native signer must not be called after economics drift");
  const status = await makeCore({ root: temporary.root }).execute({ command: "operation.status", operationId });
  assert.equal(operationRecord(status).state, "failed_before_effect");
  assert.equal(operationRecord(status).terminal, true);
  assert.match((operationRecord(status).next_actions as string[])[0] ?? "", /pay transfer prepare/);

  const next = await makeCore({ root: temporary.root, rpc: new TestRpc() }).execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: "fee-drift-reprepared-002",
    recipient: RECIPIENT,
    amount: "1",
  });
  assert.equal(next.ok, true, "terminal pre-effect failure must make the reprepare action usable");
});

test("legacy Base USDC approval keeps the signed fee cap through a harmless fee move, is owner-capped and reserved", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(temporary.root) }));
  const rpc = new TestRpc();
  const operationId = await prepareTransfer(makeCore({ root: temporary.root, rpc }), "fee-cap-001");
  const frozen = (await makeCore({ root: temporary.root }).context.state.findOperation(operationId))!;
  assert.ok(frozen.allowlist, "prepare binds the active owner allowlist policy");
  // A lower base fee and gas estimate keep the frozen envelope executable; it is signed unchanged.
  rpc.fees = { gasLimitAtomic: "60000", maxFeePerGasAtomic: "1800000000", maxPriorityFeePerGasAtomic: "1000000000" };
  const approved = await makeCore({ root: temporary.root, rpc, native: new TestNative(temporary.root) }).execute({ command: "transfer.approve", operationId });
  assert.equal(operationRecord(approved).state, "submitted_pending");
  const signed = (await makeCore({ root: temporary.root }).context.state.findOperation(operationId))!;
  assert.deepEqual(signed.economics, frozen.economics); assert.ok(signed.allowlistLease);
  assert.equal(rpc.submissions.length, 1);


  const other = await temporaryState();
  t.after(other.cleanup);
  await ensureLegacyWallet(makeCore({ root: other.root, native: new TestNative(other.root) }));
  const otherRpc = new TestRpc(), request = { command: "transfer.prepare" as const, profile: "default", idempotencyKey: "fee-cap-over-001",
    recipient: RECIPIENT, amount: "1.25" };
  const unadmitted = await makeCore({ root: other.root, rpc: otherRpc }).execute(request);
  assert.equal(unadmitted.error?.details?.reason, "allowlist_policy_required");
  await activateDirectPolicy(other.root, "default", { accounts: { evm: WALLET }, effectiveAt: "2026-08-01T00:00:00.000Z", expiresAt: null,
    admissions: [directAdmission("eip155:8453", BASE_USDC, { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000" })] });
  const capped = await makeCore({ root: other.root, rpc: otherRpc }).execute(request);
  assert.equal(capped.error?.code, "APN_ALLOWLIST_REFUSED"); assert.equal(capped.error?.details?.reason, "allowlist_per_transfer_cap_exceeded");
  assert.equal(otherRpc.balanceCalls, 0, "owner caps refuse before any RPC read");
});

test("ambiguous submission completes from an exact receipt without a second send", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(temporary.root) }));
  const rpc = new TestRpc();
  const operationId = await prepareTransfer(makeCore({ root: temporary.root, rpc }), "recover-001");
  rpc.submitError = new Error("timeout with secret provider body");
  const signingNative = new TestNative(temporary.root);
  const approved = await makeCore({ root: temporary.root, rpc, native: signingNative }).execute({
    command: "transfer.approve",
    operationId,
  });
  assert.equal(operationRecord(approved).state, "unknown_finality");
  assert.deepEqual(rpc.submissions, [RAW_TRANSACTION]);

  rpc.submitError = null;
  rpc.receipt = exactReceipt();
  const recoveryNative = new TestNative(temporary.root);
  const resumed = await makeCore({ root: temporary.root, rpc, native: recoveryNative }).execute({
    command: "operation.resume",
    operationId,
  });
  assert.equal(operationRecord(resumed).state, "completed");
  assert.equal(recoveryNative.calls.length, 0);
  assert.deepEqual(rpc.submissions, [RAW_TRANSACTION]);
  assert.equal(operationRecord(resumed).terminal, true);

  const receipt = await makeCore({ root: temporary.root }).execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, true);
  const safeReceipt = receipt.receipt as Record<string, unknown>;
  assert.equal(safeReceipt.proof_class, "confirmed_receipt_and_exact_transfer_log");
  assert.equal(safeReceipt.exact_transfer_log, true);
  assert.equal(JSON.stringify(receipt).includes(RAW_TRANSACTION), false);
});

test("the Base USDC lane records its actual OP-stack fee with the outcome and shows it in status and receipt", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(temporary.root) }));
  const rpc = new TestRpc();
  const operationId = await prepareTransfer(makeCore({ root: temporary.root, rpc }), "legacy-fee-001");
  // QA 0.5.51 DIRECT-RECEIPT-FEE-001: execution (gasUsed x price) plus the receipt's own L1 data fee and operator fee.
  rpc.receipt = { ...exactReceipt(), evmFeeFields: readEvmReceiptFeeFields({ gasUsed: "0xb411", effectiveGasPrice: "0x3b9aca00", l1Fee: "0x2710",
    operatorFeeScalar: "0x0", operatorFeeConstant: "0x0" }) };
  const approved = operationRecord(await makeCore({ root: temporary.root, rpc, native: new TestNative(temporary.root) }).execute({ command: "transfer.approve", operationId }));
  assert.equal(approved.state, "completed");
  const fee = approved.actual_network_fee as Record<string, unknown>;
  assert.deepEqual([fee.status, fee.fee_model, fee.execution_atomic, fee.l1_data_atomic, fee.operator_atomic, fee.total_atomic],
    ["complete", "op-stack", "46097000000000", "10000", "0", "46097000010000"]);
  assert.equal(approved.actual_sender_native_debit_atomic, "46097000010000", "a USDC transfer debits only the fee in ETH");
  const receipt = await makeCore({ root: temporary.root }).execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.deepEqual((receipt.receipt as Record<string, unknown>).actual_network_fee, fee);
  assert.deepEqual(operationRecord(await makeCore({ root: temporary.root }).execute({ command: "operation.status", operationId })).actual_network_fee, fee);
});

test("ambiguous submission with unavailable receipt stays unknown without nonce proof or resend", async (t) => {
  for (const outcome of ["null", "error"] as const) {
    const temporary = await temporaryState();
    t.after(temporary.cleanup);
    await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(temporary.root) }));
    const rpc = new TestRpc();
    const operationId = await prepareTransfer(makeCore({ root: temporary.root, rpc }), `unknown-receipt-${outcome}`);
    rpc.submitError = new Error("ambiguous send");
    const approved = await makeCore({ root: temporary.root, rpc, native: new TestNative(temporary.root) }).execute({ command: "transfer.approve", operationId });
    assert.equal(operationRecord(approved).state, "unknown_finality");
    rpc.submitError = null;
    if (outcome === "error") rpc.getReceipt = async () => { throw new Error("receipt provider unavailable"); };
    const resumed = await makeCore({ root: temporary.root, rpc, native: new TestNative(temporary.root) }).execute({ command: "operation.resume", operationId });
    assert.equal(operationRecord(resumed).state, "unknown_finality", outcome);
    assert.equal(operationRecord(resumed).terminal, false, outcome);
    assert.deepEqual(rpc.submissions, [RAW_TRANSACTION], outcome);
  }
});

test("invalid log stays unknown, revert is terminal, and nonce advance without the exact receipt remains held", async (t) => {
  const missingLogState = await temporaryState();
  t.after(missingLogState.cleanup);
  await ensureWallet(makeCore({ root: missingLogState.root, native: new TestNative(missingLogState.root) }));
  const missingLogRpc = new TestRpc();
  const missingLogId = await prepareTransfer(makeCore({ root: missingLogState.root, rpc: missingLogRpc }), "missing-log-001");
  missingLogRpc.receipt = { ...exactReceipt(), logs: [] };
  const missingLog = await makeCore({ root: missingLogState.root, rpc: missingLogRpc, native: new TestNative(missingLogState.root) }).execute({
    command: "transfer.approve",
    operationId: missingLogId,
  });
  assert.equal(operationRecord(missingLog).state, "unknown_finality");
  assert.equal(operationRecord(missingLog).terminal, false);

  const revertState = await temporaryState();
  t.after(revertState.cleanup);
  await ensureWallet(makeCore({ root: revertState.root, native: new TestNative(revertState.root) }));
  const revertRpc = new TestRpc();
  const revertId = await prepareTransfer(makeCore({ root: revertState.root, rpc: revertRpc }), "revert-001");
  revertRpc.receipt = { ...exactReceipt(), status: "reverted", logs: [] };
  const reverted = await makeCore({ root: revertState.root, rpc: revertRpc, native: new TestNative(revertState.root) }).execute({
    command: "transfer.approve",
    operationId: revertId,
  });
  assert.equal(operationRecord(reverted).state, "failed_confirmed_revert");

  const supersededState = await temporaryState();
  t.after(supersededState.cleanup);
  await ensureWallet(makeCore({ root: supersededState.root, native: new TestNative(supersededState.root) }));
  const supersededRpc = new TestRpc();
  const supersededId = await prepareTransfer(makeCore({ root: supersededState.root, rpc: supersededRpc }), "superseded-001");
  await makeCore({ root: supersededState.root, rpc: supersededRpc, native: new TestNative(supersededState.root) }).execute({
    command: "transfer.approve",
    operationId: supersededId,
  });
  const superseded = await makeCore({ root: supersededState.root, rpc: supersededRpc, native: new TestNative(supersededState.root) }).execute({
    command: "operation.resume",
    operationId: supersededId,
  });
  assert.equal(operationRecord(superseded).state, "submitted_pending");
  assert.equal(operationRecord(superseded).terminal, false);
  const stillPending = await makeCore({ root: supersededState.root, rpc: supersededRpc,
    native: new TestNative(supersededState.root) }).execute({ command: "operation.resume", operationId: supersededId });
  assert.equal(operationRecord(stillPending).state, "submitted_pending");
  assert.equal(operationRecord(stillPending).terminal, false);
  assert.equal(supersededRpc.submissions.length, 1, "repeated exact-hash observation must never rebroadcast");
});

test("safe envelope redacts raw bytes, raw idempotency, and native exception text", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const native = new TestNative(temporary.root);
  native.rejectMessage = "CANARY_PRIVATE_KEY_012345";
  const envelope = await makeCore({ root: temporary.root, native }).execute({ command: "wallet.ensure", profile: "default" });
  assert.deepEqual(Object.keys(envelope), [
    "version", "request_id", "command", "ok", "proof_class", "data", "operation", "receipt", "error", "next_actions",
  ]);
  assert.match(envelope.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes("CANARY_PRIVATE_KEY_012345"), false);
  assert.equal(serialized.includes("rawTransaction"), false);
});
