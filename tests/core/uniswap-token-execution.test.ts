import assert from "node:assert/strict";
import test from "node:test";
import { domainHash } from "../../src/canonical.js";
import { newUniswapTokenOperation, UniswapTokenJournal } from "../../src/swap/uniswap-v3/token-operation.js";
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
    sendResult: "accepted" | "ambiguous" = "accepted", revalidations = 0, rejectRevalidation = false, rejectGuard = false, rejectSeal = false;
  const released: string[] = [], committed: string[] = [];
  const ports = { now: () => NOW, foregroundApprove: async () => undefined, foregroundCleanup: async () => undefined,
    withAccountLock: async <T>(_op: unknown, work: () => Promise<T>) => await work(), allocateNonce: async () => String(7 + sends.length),
    releaseNonce: async (_op: unknown, kind: TokenEffectKind, nonce: string) => { released.push(`${kind}:${nonce}`); },
    commitNonce: async (_op: unknown, kind: TokenEffectKind, nonce: string) => { committed.push(`${kind}:${nonce}`); },
    currentAllowance: async () => currentAllowance, guard: async () => { if (rejectGuard) throw new Error("refused"); }, revalidate: async () => { revalidations += 1; if (rejectRevalidation) throw new Error("drift"); },
    reserveUsage: async () => ({ reservationId: "d".repeat(64), state: "reserved" as const }),
    currentUsage: async (op: { usageReservationId: string | null; usageState: any }) => ({ reservationId: op.usageReservationId!, state: op.usageState }),
    followUsage: async (_op: unknown, target: any) => ({ reservationId: "d".repeat(64), state: target }),
    seal: async (_op: unknown, kind: TokenEffectKind) => { if (rejectSeal) throw new Error("sign failed"); return { transactionHash: kind === "approval" ? H("1") : kind === "swap" ? H("2") : H("3"), envelopeHash: "e".repeat(64) }; },
    send: async (_op: unknown, kind: TokenEffectKind) => { sends.push(kind); return sendResult; },
    observe: async (_op: unknown, _kind: TokenEffectKind, hash: string) => observations.get(hash) ?? null };
  return { runtime: new UniswapTokenExecution(journal, ports), journal, operation, sends, observations,
    allowance: (v: string) => { currentAllowance = v; }, sendResult: (v: "accepted" | "ambiguous") => { sendResult = v; },
    rejectRevalidation: () => { rejectRevalidation = true; }, rejectGuard: () => { rejectGuard = true; }, rejectSeal: () => { rejectSeal = true; }, released, committed,
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
    seal: async () => { throw new Error("must not sign"); }, send: async () => { throw new Error("must not resend"); }, observe: async () => null });
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
test("mismatched allowance refuses and reverted swap requires explicit cleanup", async (t) => { const temp = await temporaryState(); t.after(temp.cleanup);
  await assert.rejects(fixture(temp.root, "2"), { code: "APN_STATE_CORRUPT" });
  const other = await temporaryState(); t.after(other.cleanup); const g = await fixture(other.root, "1000000"); let op = await g.runtime.approve(g.operation.operationId);
  assert.equal(op.phase, "submitted"); g.observations.set(H("2"), { status: "reverted", transactionHash: H("2"), gasDebitWei: "100", allowanceAtomic: "1000000" });
  op = await g.runtime.status(op.operationId); assert.equal(op.phase, "cleanup_required"); assert.deepEqual(g.sends, ["swap"]);
  op = await g.runtime.execute(op.operationId); assert.equal(op.phase, "cleanup_required"); assert.deepEqual(g.sends, ["swap"]);
  op = await g.runtime.cleanup(op.operationId); assert.equal(op.phase, "cleanup_submitted"); assert.deepEqual(g.sends, ["swap", "cleanup"]);
  g.observations.set(H("3"), { status: "success", transactionHash: H("3"), gasDebitWei: "50", allowanceAtomic: "0" }); g.allowance("0");
  op = await g.runtime.status(op.operationId); assert.equal(op.phase, "cleaned");
});
test("post-approval revalidation drift durably requires explicit cleanup and never signs the swap", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root); let op = await f.runtime.approve(f.operation.operationId);
  f.observations.set(H("1"), { status: "success", transactionHash: H("1"), gasDebitWei: "100", allowanceAtomic: "1000000" }); f.allowance("1000000");
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "approval_observed"); f.rejectRevalidation();
  op = await f.runtime.execute(op.operationId); assert.equal(op.phase, "cleanup_required"); assert.equal(op.cleanupReason, "post_approval_revalidation_failed");
  assert.deepEqual(f.sends, ["approval"]); assert.equal((await f.journal.load(op.operationId))?.phase, "cleanup_required");
  op = await f.runtime.cleanup(op.operationId); assert.equal(op.phase, "cleanup_submitted"); assert.deepEqual(f.sends, ["approval", "cleanup"]);
});
