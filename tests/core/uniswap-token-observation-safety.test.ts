import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { Hex } from "viem";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import { envelopeOf, UniswapTokenCustody } from "../../src/swap/uniswap-v3/token-custody.js";
import { UniswapTokenEffectJournal } from "../../src/swap/uniswap-v3/token-effects.js";
import { UniswapTokenExecution, type TokenEffectKind, type UniswapTokenExecutionPorts } from "../../src/swap/uniswap-v3/token-execution.js";
import { newUniswapTokenOperation, tokenAttempt, transitionUniswapToken, UniswapTokenJournal } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute } from "../../src/swap/uniswap-v3/token-route.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { temporaryState } from "./helpers.js";
const NOW = new Date("2026-09-22T00:00:00.000Z"), HASH = `0x${"1".repeat(64)}` as Hex;
async function fixture(root: string, kind: TokenEffectKind = "approval", hash: string | null = HASH) {
  const journal = new UniswapTokenJournal(root), effects = new UniswapTokenEffectJournal(root), gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  const base = newUniswapTokenOperation({ operationId: "a".repeat(64), profile: "token-swap", account: "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1",
    route: createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: "0x2222222222222222222222222222222222222222", amountIn: "1000000", amountOutMinimum: "990000", deadline: 1_900_000_000 }),
    approvalCapAtomic: "1000000", allowanceAtPrepare: "1000000", approvalGas: gas, swapGas: gas, cleanupGas: gas, maximumNativeDebitWei: "600000", policyDigest: "b".repeat(64), mechanismDigest: "c".repeat(64), now: NOW });
  const phase = kind === "approval" ? "approval_submission_started" : kind === "swap" ? "submission_started" : "cleanup_submission_started";
  const op = await journal.save(transitionUniswapToken(base, phase, { usageReservationId: "d".repeat(64), usageState: "reserved", [`${kind}Attempt`]: { ...tokenAttempt(base, kind, "7", NOW), transactionHash: hash } }, NOW));
  const counts = { wrapping: 0, custody: 0, send: 0, sign: 0, nonce: 0, foreground: 0, finalized: 0, observations: 0 }, forbidden = async (): Promise<never> => { counts.custody++; throw new Error("custody forbidden"); };
  const wrapping = { load: async () => { counts.wrapping++; throw new Error("key forbidden"); }, create: async () => { counts.wrapping++; throw new Error("key forbidden"); } };
  const custody = new UniswapTokenCustody(new StateStore(root), wrapping, async () => { throw new Error("RPC forbidden in binding"); }, () => NOW);
  let usage: "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" = "reserved", success = false;
  const ports: UniswapTokenExecutionPorts = { now: () => NOW, foregroundApprove: async () => { counts.foreground++; throw new Error("foreground forbidden"); }, foregroundCleanup: forbidden,
    withAccountLock: forbidden, allocateNonce: async () => { counts.nonce++; throw new Error("nonce forbidden"); }, currentAllowance: forbidden, releaseNonce: forbidden, commitNonce: forbidden,
    guard: forbidden, revalidate: forbidden, reserveUsage: forbidden, currentUsage: async () => ({ reservationId: "d".repeat(64), state: usage }),
    followUsage: async (_op, target) => { if (target === "finalized") counts.finalized++; usage = target; return { reservationId: "d".repeat(64), state: usage }; },
    seal: async () => { counts.sign++; throw new Error("sign forbidden"); }, probeSealed: forbidden,
    recoverSealed: async (op, kind, nonce) => await custody.probeJournaled(op, kind, nonce), send: async () => { counts.send++; throw new Error("send forbidden"); },
    observe: async (op, kind, hash) => { await custody.bindEffectProvider(op, kind, hash); counts.observations++; return success ? { status: "success", transactionHash: hash, gasDebitWei: "1", allowanceAtomic: kind === "approval" ? "1000000" : "0", inputDebitAtomic: "1000000", outputCreditAtomic: "990000" } : null; } };
  return { op, journal, effects, custody, counts, ports, runtime: () => new UniswapTokenExecution(new UniswapTokenJournal(root), ports), success: () => { success = true; }, effectPath: join(root, "uniswap-token-effects", `${op.operationId}-${kind}.json`) };
}
function noCustody(counts: { wrapping: number; custody: number; send: number; sign: number; nonce: number; foreground: number }) {
  assert.deepEqual([counts.wrapping, counts.custody, counts.send, counts.sign, counts.nonce, counts.foreground], [0, 0, 0, 0, 0, 0]);
}
test("journaled started approval, swap and cleanup reopen and observe the same hash without custody", async (t) => {
  const original = EncryptedWalletStore.prototype.describe;
  EncryptedWalletStore.prototype.describe = async () => { throw new Error("decryption forbidden"); };
  t.after(() => { EncryptedWalletStore.prototype.describe = original; });
  for (const kind of ["approval", "swap", "cleanup"] as const) {
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root, kind);
    await f.effects.seal(f.op, kind, HASH, envelopeOf(f.op, kind, "7"), NOW);
    await f.effects.markStarted(f.op, kind, NOW); await f.effects.markOutcome(f.op, kind, "send_ambiguous", NOW);
    const before = await readFile(f.effectPath, "utf8");
    await f.runtime().status(f.op.operationId); await f.runtime().execute(f.op.operationId); await f.runtime().status(f.op.operationId);
    assert.equal(await readFile(f.effectPath, "utf8"), before); noCustody(f.counts);
    assert.equal((await f.effects.load(f.op, kind))?.sendAttempts, 1);
  }
});
test("hashless started recovery uses public hash, never submits, and finalizes swap usage once", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root, "swap", null);
  await f.effects.seal(f.op, "swap", HASH, envelopeOf(f.op, "swap", "7"), NOW);
  let op = await f.runtime().status(f.op.operationId); assert.equal(op.phase, "unknown_finality"); assert.equal(op.swapAttempt?.transactionHash, HASH);
  await f.runtime().execute(op.operationId); f.success(); op = await f.runtime().status(op.operationId);
  assert.equal(op.phase, "observed"); assert.equal(op.usageState, "finalized");
  await f.runtime().status(op.operationId); await f.runtime().execute(op.operationId);
  assert.equal(f.counts.finalized, 1); assert.equal((await f.effects.load(f.op, "swap"))?.phase, "sealed"); noCustody(f.counts);
});
test("missing public journal refuses hashed and hashless recovery without custody", async (t) => {
  for (const hash of [HASH, null]) {
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root, "approval", hash);
    for (const command of ["status", "execute"] as const) await assert.rejects(f.runtime()[command](f.op.operationId), (e: any) => e.code === "APN_OPERATION_BLOCKED" && e.details?.reason === "uniswap_token_public_effect_missing");
    assert.equal((await f.journal.load(f.op.operationId))?.integrityHash, f.op.integrityHash); noCustody(f.counts);
  }
});
test("legacy public journal refuses missing provider binding without opening wallet or upgrading", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  await f.effects.seal(f.op, "approval", HASH, envelopeOf(f.op, "approval", "7"), NOW);
  const { integrityHash: _hash, primaryProviderId: _provider, ...body } = JSON.parse(await readFile(f.effectPath, "utf8"));
  const legacy = { ...body, schemaVersion: "apn.uniswap-token-effect.v1" }; await writeFile(f.effectPath, `${canonicalJson({ ...legacy, integrityHash: hashObject(legacy) })}\n`, { mode: 0o600 });
  const before = await readFile(f.effectPath, "utf8"), call = Object.assign(async () => { throw new Error("RPC forbidden"); }, { primaryPoolEnabled: () => true });
  const custody = new UniswapTokenCustody(new StateStore(temp.root), { load: async () => { throw new Error("key forbidden"); }, create: async () => { throw new Error("key forbidden"); } }, call, () => NOW);
  await assert.rejects(custody.bindEffectProvider(f.op, "approval", HASH), (e: any) => e.details?.reason === "uniswap_token_provider_binding_missing");
  assert.equal(await readFile(f.effectPath, "utf8"), before); noCustody(f.counts);
});
test("public hash, marker and envelope tampering refuses observation before RPC", async (t) => {
  for (const field of ["transactionHash", "markerHash", "envelopeHash"] as const) {
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
    await f.effects.seal(f.op, "approval", HASH, envelopeOf(f.op, "approval", "7"), NOW);
    const { integrityHash: _hash, ...body } = JSON.parse(await readFile(f.effectPath, "utf8"));
    const changed = { ...body, [field]: field === "transactionHash" ? `0x${"2".repeat(64)}` : "2".repeat(64) };
    await writeFile(f.effectPath, `${canonicalJson({ ...changed, integrityHash: hashObject(changed) })}\n`, { mode: 0o600 });
    await assert.rejects(f.runtime().status(f.op.operationId), (e: any) => e.code === "APN_STATE_CORRUPT"); assert.equal(f.counts.observations, 0); noCustody(f.counts);
  }
});
test("installed factory status binds public journal with zero wallet reads or wrapping loads", async (t) => {
  const { createUniswapTokenRuntime } = await import("../../src/swap/uniswap-v3/token-runtime-factory.js"),
    { UniswapTokenUsage } = await import("../../src/swap/uniswap-v3/token-usage.js");
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  await f.effects.seal(f.op, "approval", HASH, envelopeOf(f.op, "approval", "7"), NOW);
  const describe = EncryptedWalletStore.prototype.describe, current = UniswapTokenUsage.prototype.current;
  let walletReads = 0, wrappingLoads = 0, rpcReads = 0;
  EncryptedWalletStore.prototype.describe = async () => { walletReads++; throw new Error("wallet decryption forbidden"); };
  UniswapTokenUsage.prototype.current = async () => ({ reservationId: "d".repeat(64), state: "reserved" });
  t.after(() => { EncryptedWalletStore.prototype.describe = describe; UniswapTokenUsage.prototype.current = current; });
  const runtime = createUniswapTokenRuntime({ state: new StateStore(temp.root), clock: { now: () => NOW }, foreground: "refuse",
    wrapping: { load: async () => { wrappingLoads++; throw new Error("key forbidden"); }, create: async () => { throw new Error("key creation forbidden"); } },
    call: async (method, params) => { rpcReads++; if (method === "eth_chainId") return "0x1";
      assert.ok(["eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(method)); assert.equal(params[0], HASH); return null; } });
  await runtime.status(f.op.operationId); await runtime.execute(f.op.operationId);
  assert.ok(rpcReads > 0); assert.equal(walletReads, 0); assert.equal(wrappingLoads, 0);
});

test("hashless attempted cleanup recovery cannot release usage or open custody", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root, "approval", null);
  const op = await f.journal.save(transitionUniswapToken(f.op, "cleanup_required", { cleanupReason: "approval_sign_failed", usageState: "failed_before_effect" }, NOW));
  f.ports.currentUsage = async () => ({ reservationId: "d".repeat(64), state: "failed_before_effect" });
  let releases = 0; f.ports.followUsage = async () => { releases++; throw new Error("usage release forbidden"); };
  await assert.rejects(f.runtime().status(op.operationId), (e: any) => e.details?.reason === "uniswap_token_public_effect_missing");
  assert.equal((await f.journal.load(op.operationId))?.integrityHash, op.integrityHash); assert.equal(releases, 0); noCustody(f.counts);
});
test("unattempted failure keeps the existing safe usage reconciliation", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root, "approval", null);
  const op = await f.journal.save(transitionUniswapToken(f.op, "cleanup_required", { approvalAttempt: null, cleanupReason: "pre_effect_failure", usageState: "failed_before_effect" }, NOW));
  f.ports.currentUsage = async () => ({ reservationId: "d".repeat(64), state: "failed_before_effect" });
  assert.equal((await f.runtime().status(op.operationId)).phase, "cleaned"); noCustody(f.counts);
});
