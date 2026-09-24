import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AssetUsageState } from "../../src/asset-usage-ledger.js";
import { domainHash, hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { newUniswapTokenOperation, tokenAttempt, transitionUniswapToken, UniswapTokenJournal, validateUniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { UniswapTokenExecution, type TokenEffectKind, type TokenEffectObservation } from "../../src/swap/uniswap-v3/token-execution.js";
import { createUniswapTokenRoute } from "../../src/swap/uniswap-v3/token-route.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { temporaryState } from "./helpers.js";
const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", RECIPIENT = "0x2222222222222222222222222222222222222222";
const H = (c: string) => `0x${c.repeat(64)}`, NOW = new Date("2026-09-22T00:00:00.000Z");
async function fixture(root: string, allowance = "0") {
  const journal = new UniswapTokenJournal(root), route = createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT,
    recipient: RECIPIENT, amountIn: "1000000", amountOutMinimum: "990000", deadline: 1_900_000_000 });
  const gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  const operation = await journal.save(newUniswapTokenOperation({ operationId: "a".repeat(64), profile: "token-swap", account: ACCOUNT, route,
    approvalCapAtomic: "1000000", allowanceAtPrepare: allowance, approvalGas: gas, swapGas: gas, cleanupGas: gas,
    maximumNativeDebitWei: "600000", policyDigest: domainHash("p", "p"), mechanismDigest: domainHash("m", "m"), now: NOW }));
  const sends: TokenEffectKind[] = [], observations = new Map<string, TokenEffectObservation>(); let currentAllowance = allowance,
    sendResult: "accepted" | "ambiguous" = "accepted", revalidations = 0, rejectRevalidation = false, guardError: unknown = null, rejectSeal = false,
    currentUsageState: AssetUsageState = "reserved";
  const released: string[] = [], committed: string[] = [];
  const ports = { now: () => NOW, foregroundApprove: async () => undefined, foregroundCleanup: async () => undefined,
    withAccountLock: async <T>(_op: unknown, work: () => Promise<T>) => await work(), allocateNonce: async () => String(7 + sends.length),
    releaseNonce: async (_op: unknown, kind: TokenEffectKind, nonce: string) => { released.push(`${kind}:${nonce}`); },
    commitNonce: async (_op: unknown, kind: TokenEffectKind, nonce: string) => { committed.push(`${kind}:${nonce}`); },
    currentAllowance: async () => currentAllowance, guard: async () => { if (guardError !== null) throw guardError; }, revalidate: async () => { revalidations += 1; if (rejectRevalidation) throw new Error("drift"); },
    reserveUsage: async () => { currentUsageState = "reserved"; return { reservationId: "d".repeat(64), state: currentUsageState }; },
    currentUsage: async (op: { usageReservationId: string | null }) => ({ reservationId: op.usageReservationId!, state: currentUsageState }),
    followUsage: async (_op: unknown, target: AssetUsageState) => { currentUsageState = target; return { reservationId: "d".repeat(64), state: currentUsageState }; },
    seal: async (_op: unknown, kind: TokenEffectKind) => { if (rejectSeal) throw new Error("sign failed"); return { transactionHash: kind === "approval" ? H("1") : kind === "swap" ? H("2") : H("3"), envelopeHash: "e".repeat(64) }; },
    probeSealed: async () => null,
    send: async (_op: unknown, kind: TokenEffectKind) => { sends.push(kind); return sendResult; },
    observe: async (_op: unknown, _kind: TokenEffectKind, hash: string) => observations.get(hash) ?? null };
  return { runtime: new UniswapTokenExecution(journal, ports), journal, operation, sends, observations,
    allowance: (v: string) => { currentAllowance = v; }, sendResult: (v: "accepted" | "ambiguous") => { sendResult = v; },
    rejectRevalidation: () => { rejectRevalidation = true; }, rejectGuard: (error: unknown = new Error("refused")) => { guardError = error; },
    rejectSeal: () => { rejectSeal = true; }, usageState: (state: AssetUsageState) => { currentUsageState = state; }, released, committed,
    revalidations: () => revalidations };
}
test("exact approval then swap finalizes with zero allowance and bounded debit", async (t) => { const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  let op = await f.runtime.approve(f.operation.operationId); assert.equal(op.phase, "approval_submitted"); assert.deepEqual(f.sends, ["approval"]);
  f.observations.set(H("1"), { status: "success", transactionHash: H("1"), gasDebitWei: "100", allowanceAtomic: "1000000" }); f.allowance("1000000");
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "approval_observed"); op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "submitted");
  f.observations.set(H("2"), { status: "success", transactionHash: H("2"), gasDebitWei: "100", allowanceAtomic: "0", inputDebitAtomic: "1000000", outputCreditAtomic: "990000" }); f.allowance("0");
  op = await f.runtime.status(op.operationId); assert.equal(op.phase, "observed"); assert.equal(op.receipt?.residualAllowanceAtomic, "0");
  assert.equal(op.receipt?.nativeDebitWei, "200"); assert.deepEqual(f.sends, ["approval", "swap"]); assert.equal(f.revalidations(), 1);
  assert.equal((await new UniswapTokenJournal(temp.root).load(op.operationId))?.integrityHash, op.integrityHash);
});
test("ambiguous approval and swap are never resent after restart", async (t) => { const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  f.sendResult("ambiguous"); let op = await f.runtime.approve(f.operation.operationId); assert.equal(op.phase, "approval_unknown_finality");
  const restarted = new UniswapTokenExecution(new UniswapTokenJournal(temp.root), { now: () => NOW, foregroundApprove: async () => undefined,
    foregroundCleanup: async () => undefined, withAccountLock: async <T>(_op: unknown, work: () => Promise<T>) => await work(),
    allocateNonce: async () => "99", currentAllowance: async () => "0", guard: async () => undefined, revalidate: async () => undefined,
    releaseNonce: async () => undefined, commitNonce: async () => undefined,
    reserveUsage: async () => ({ reservationId: "d".repeat(64), state: "reserved" as const }),
    currentUsage: async (current) => ({ reservationId: current.usageReservationId!, state: current.usageState! }),
    followUsage: async (_current, target) => ({ reservationId: "d".repeat(64), state: target }),
    seal: async () => { throw new Error("must not sign"); }, probeSealed: async () => null,
    send: async () => { throw new Error("must not resend"); }, observe: async () => null });
  op = await restarted.execute(op.operationId); assert.equal(op.phase, "approval_unknown_finality"); assert.deepEqual(f.sends, ["approval"]);
  assert.equal(f.revalidations(), 0);
});
test("pre-sign refusal and signing failure release nonce while a sealed ambiguous effect commits it", async (t) => {
  const refused = await temporaryState(); t.after(refused.cleanup); const a = await fixture(refused.root); a.rejectGuard();
  let op = await a.runtime.approve(a.operation.operationId); assert.equal(op.phase, "cleanup_required"); assert.deepEqual(a.released, ["approval:7"]); assert.deepEqual(a.committed, []);
  const unsigned = await temporaryState(); t.after(unsigned.cleanup); const b = await fixture(unsigned.root); b.rejectSeal();
  op = await b.runtime.approve(b.operation.operationId); assert.equal(op.phase, "cleanup_required"); assert.deepEqual(b.released, ["approval:7"]); assert.deepEqual(b.committed, []);
  const ambiguous = await temporaryState(); t.after(ambiguous.cleanup); const c = await fixture(ambiguous.root); c.sendResult("ambiguous");
  op = await c.runtime.approve(c.operation.operationId); assert.equal(op.phase, "approval_unknown_finality"); assert.deepEqual(c.released, []); assert.deepEqual(c.committed, ["approval:7"]);
});
test("restart never signs an attempt whose reusable nonce was reassigned", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root), usage = { reservationId: "d".repeat(64), state: "reserved" as const };
  const approved = await f.journal.save(transitionUniswapToken(f.operation, "approved", { usageReservationId: usage.reservationId, usageState: usage.state }, NOW));
  let op = await f.journal.save(transitionUniswapToken(approved, "approval_submission_started", { approvalAttempt: tokenAttempt(approved, "approval", "7", NOW) }, NOW));
  const released: string[] = [];
  const restarted = new UniswapTokenExecution(new UniswapTokenJournal(temp.root), { now: () => NOW, foregroundApprove: async () => undefined,
    foregroundCleanup: async () => undefined, withAccountLock: async <T>(_op: unknown, work: () => Promise<T>) => await work(),
    allocateNonce: async () => "8", releaseNonce: async (_op, kind, nonce) => { released.push(`${kind}:${nonce}`); }, commitNonce: async () => undefined,
    currentAllowance: async () => "0", guard: async () => undefined, revalidate: async () => undefined, reserveUsage: async () => usage,
    currentUsage: async () => usage, followUsage: async () => usage, seal: async () => { throw new Error("must not sign"); }, probeSealed: async () => null,
    send: async () => { throw new Error("must not send"); }, observe: async () => null });
  op = await restarted.execute(op.operationId); assert.equal(op.phase, "cleanup_required"); assert.equal(op.cleanupReason, "approval_nonce_reservation_lost");
  assert.deepEqual(released, ["approval:8"]);
});
test("mismatched allowance refuses and reverted swap requires explicit cleanup", async (t) => { const temp = await temporaryState(); t.after(temp.cleanup);
  await assert.rejects(fixture(temp.root, "2"), { code: "APN_STATE_CORRUPT" });
  const other = await temporaryState(); t.after(other.cleanup); const g = await fixture(other.root, "1000000"); let op = await g.runtime.approve(g.operation.operationId);
  assert.equal(op.phase, "approval_observed"); assert.deepEqual(g.sends, []); op = await g.runtime.execute(op.operationId); assert.equal(op.phase, "submitted");
  g.observations.set(H("2"), { status: "reverted", transactionHash: H("2"), gasDebitWei: "100", allowanceAtomic: "1000000" });
  op = await g.runtime.status(op.operationId); assert.equal(op.phase, "cleanup_required"); assert.deepEqual(g.sends, ["swap"]);
  op = await g.runtime.execute(op.operationId); assert.equal(op.phase, "cleanup_required"); assert.deepEqual(g.sends, ["swap"]);
  op = await g.runtime.cleanup(op.operationId); assert.equal(op.phase, "cleanup_submitted"); assert.deepEqual(g.sends, ["swap", "cleanup"]);
  g.observations.set(H("3"), { status: "success", transactionHash: H("3"), gasDebitWei: "50", allowanceAtomic: "0" }); g.allowance("0");
  op = await g.runtime.status(op.operationId); assert.equal(op.phase, "cleaned");
});
test("successful swap with residual allowance requires explicit cleanup and a zero-allowance observation", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root); let op = await f.runtime.approve(f.operation.operationId);
  f.observations.set(H("1"), { status: "success", transactionHash: H("1"), gasDebitWei: "100", allowanceAtomic: "1000000" }); f.allowance("1000000");
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "approval_observed");
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "submitted"); assert.deepEqual(f.sends, ["approval", "swap"]);
  f.observations.set(H("2"), { status: "success", transactionHash: H("2"), gasDebitWei: "100", allowanceAtomic: "1", inputDebitAtomic: "1000000", outputCreditAtomic: "990000" }); f.allowance("1");
  op = await f.runtime.status(op.operationId); assert.equal(op.phase, "cleanup_required"); assert.equal(op.cleanupReason, "swap_effect_mismatch");
  assert.equal(op.receipt, null); assert.equal(op.swapAttempt?.transactionHash, H("2")); assert.equal(f.sends.filter((kind) => kind === "swap").length, 1);

  op = await f.runtime.cleanup(op.operationId); assert.equal(op.phase, "cleanup_submitted"); assert.equal(op.receipt, null);
  assert.deepEqual(f.sends, ["approval", "swap", "cleanup"]);
  f.observations.set(H("3"), { status: "success", transactionHash: H("3"), gasDebitWei: "50", allowanceAtomic: "1" });
  op = await f.runtime.status(op.operationId); assert.equal(op.phase, "cleanup_unknown_finality"); assert.equal(op.receipt, null);
  assert.equal(f.sends.filter((kind) => kind === "swap").length, 1);

  f.observations.set(H("3"), { status: "success", transactionHash: H("3"), gasDebitWei: "50", allowanceAtomic: "0" }); f.allowance("0");
  op = await f.runtime.status(op.operationId); assert.equal(op.phase, "cleaned"); assert.equal(op.receipt, null);
  assert.equal(f.sends.filter((kind) => kind === "swap").length, 1);
});
test("post-approval revalidation drift durably requires explicit cleanup and never signs the swap", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root); let op = await f.runtime.approve(f.operation.operationId);
  f.observations.set(H("1"), { status: "success", transactionHash: H("1"), gasDebitWei: "100", allowanceAtomic: "1000000" }); f.allowance("1000000");
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "approval_observed"); f.rejectRevalidation();
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "cleanup_required"); assert.equal(op.cleanupReason, "post_approval_revalidation_failed");
  assert.deepEqual(f.sends, ["approval"]); assert.equal((await f.journal.load(op.operationId))?.phase, "cleanup_required");
  op = await f.runtime.cleanup(op.operationId); assert.equal(op.phase, "cleanup_submitted"); assert.deepEqual(f.sends, ["approval", "cleanup"]);
});
test("zero allowance cleanup records no-effect evidence, releases usage, and sends nothing", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root); f.rejectGuard();
  let op = await f.runtime.approve(f.operation.operationId); assert.equal(op.phase, "cleanup_required"); assert.equal(op.approvalAttempt?.transactionHash, null);
  op = await f.runtime.cleanup(op.operationId); assert.equal(op.phase, "cleaned"); assert.equal(op.cleanupReason, "zero_allowance_no_effect");
  assert.deepEqual(op.cleanupEvidence, { schemaVersion: "apn.uniswap-token-cleanup-evidence.v1", kind: "zero_allowance_no_effect",
    source: "current_allowance", observedAllowanceAtomic: "0", observedAt: NOW.toISOString() });
  assert.equal(op.cleanupAttempt, null); assert.equal(op.usageState, "failed_before_effect"); assert.equal(op.accumulatedNativeDebitWei, "0");
  assert.deepEqual(f.sends, []);
});
test("zero allowance cannot claim no-effect cleanup after an approval hash exists", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root); let op = await f.runtime.approve(f.operation.operationId);
  f.observations.set(H("1"), { status: "success", transactionHash: H("1"), gasDebitWei: "100", allowanceAtomic: "1000000" }); f.allowance("1000000");
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "approval_observed"); f.rejectRevalidation();
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "cleanup_required"); f.allowance("0");
  await assert.rejects(f.runtime.cleanup(op.operationId), (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === "uniswap_cleanup_effect_exists");
  const persisted = await f.journal.load(op.operationId); assert.equal(persisted?.cleanupEvidence, null); assert.equal(persisted?.usageState, "reserved");
  assert.deepEqual(f.sends, ["approval"]);
});
test("status repairs the live ledger-terminal split brain without allowance reads, signing, or sending", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root); f.rejectGuard();
  let op = await f.runtime.approve(f.operation.operationId); assert.equal(op.phase, "cleanup_required"); f.usageState("failed_before_effect"); f.allowance("999999");
  op = await f.runtime.status(op.operationId); assert.equal(op.phase, "cleaned"); assert.equal(op.usageState, "failed_before_effect");
  assert.equal(op.cleanupEvidence?.source, "legacy_usage_reconciliation"); assert.equal(op.cleanupAttempt, null); assert.deepEqual(f.sends, []);
  assert.equal((await f.runtime.cleanup(op.operationId)).integrityHash, op.integrityHash);
});
test("pre-sign diagnostics retain only classified fields for provider and guard failures", async (t) => {
  const rows = [
    new ApnError("APN_RPC_PROTOCOL", "http", { reason: "http_status", rpcMethod: "eth_call", endpointRole: "primary", url: "https://secret.example/key" }),
    new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline", rpcMethod: "batch", endpointRole: "archive", params: "secret" }),
    new ApnError("APN_OPERATION_BLOCKED", "policy", { reason: "swap_owner_admission_required" }),
    new ApnError("APN_OPERATION_BLOCKED", "pin", { reason: "uniswap_code_pin_drift" }),
  ];
  for (const [index, error] of rows.entries()) { const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root); f.rejectGuard(error);
    const op = await f.runtime.approve(f.operation.operationId); assert.equal(op.cleanupReason, "approval_pre_sign_failed");
    assert.deepEqual(op.preSignFailure, { code: error.code, reason: error.details?.reason ?? error.details?.transportReason ?? null, rpcMethod: error.details?.rpcMethod ?? null,
      endpointRole: error.details?.endpointRole ?? null, phase: "approval_submission_started" }, String(index));
    assert.doesNotMatch(JSON.stringify(op.preSignFailure), /secret|https:|params|address/u); }
});
test("pre-sign diagnostics reject address, hash, key-shaped, and arbitrary strings field by field", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  f.rejectGuard(new ApnError("APN_OPERATION_BLOCKED", "hostile", { reason: ACCOUNT, rpcMethod: H("a"), endpointRole: "private_key", secret: "key" }));
  const op = await f.runtime.approve(f.operation.operationId); assert.deepEqual(op.preSignFailure, {
    code: "APN_OPERATION_BLOCKED", reason: null, rpcMethod: null, endpointRole: null, phase: "approval_submission_started",
  });
  for (const [field, value] of [["code", "SECRET_KEY"], ["reason", ACCOUNT], ["rpcMethod", H("b")], ["endpointRole", "arbitrary"]] as const) {
    const preSignFailure = { ...op.preSignFailure!, [field]: value };
    assert.throws(() => validateUniswapTokenOperation({ ...op, preSignFailure }), { code: "APN_STATE_CORRUPT" }, field);
  }
});
test("legacy v1 operations remain readable and upgrade on the next transition", async () => {
  const current = newUniswapTokenOperation({ operationId: "b".repeat(64), profile: "legacy", account: ACCOUNT,
    route: createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: RECIPIENT,
      amountIn: "1000000", amountOutMinimum: "990000", deadline: 1_900_000_000 }), approvalCapAtomic: "1000000", allowanceAtPrepare: "0",
    approvalGas: { gasLimit: "1", maxFeePerGas: "3", maxPriorityFeePerGas: "1" }, swapGas: { gasLimit: "1", maxFeePerGas: "3", maxPriorityFeePerGas: "1" },
    cleanupGas: { gasLimit: "1", maxFeePerGas: "3", maxPriorityFeePerGas: "1" }, maximumNativeDebitWei: "9", policyDigest: "c".repeat(64), mechanismDigest: "d".repeat(64), now: NOW });
  const { cleanupEvidence: _e, preSignFailure: _f, integrityHash: _h, ...legacyBody } = current;
  const legacy = validateUniswapTokenOperation({ ...legacyBody, schemaVersion: "apn.uniswap-token-operation.v1", integrityHash: hashObject({ ...legacyBody, schemaVersion: "apn.uniswap-token-operation.v1" }) });
  assert.equal(legacy.schemaVersion, "apn.uniswap-token-operation.v1"); assert.equal(transitionUniswapToken(legacy, "prepared", {}, NOW).schemaVersion, "apn.uniswap-token-operation.v2");
});
test("sanitized live recovery fixture preserves the durable split-brain shape", () => {
  const fixture = JSON.parse(readFileSync("tests/core/fixtures/uniswap-token-live-split-brain.json", "utf8"));
  const op = validateUniswapTokenOperation(fixture.operation); assert.equal(op.schemaVersion, "apn.uniswap-token-operation.v1");
  assert.equal(op.phase, "cleanup_required"); assert.equal(op.cleanupReason, "approval_pre_sign_failed");
  assert.equal(op.approvalAttempt?.nonce, "39"); assert.equal(op.approvalAttempt?.transactionHash, null);
  assert.deepEqual(fixture.authoritativeUsage, { reservationId: op.usageReservationId, state: "failed_before_effect" });
});
