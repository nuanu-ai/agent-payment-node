import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { ApnError } from "../../src/errors.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { envelopeOf, UniswapTokenCustody } from "../../src/swap/uniswap-v3/token-custody.js";
import { UniswapTokenEffectJournal } from "../../src/swap/uniswap-v3/token-effects.js";
import { UniswapTokenExecution, type TokenEffectKind } from "../../src/swap/uniswap-v3/token-execution.js";
import { UniswapTokenNonceStore } from "../../src/swap/uniswap-v3/token-nonce.js";
import { occupiedUniswapTokenNonces } from "../../src/swap/uniswap-v3/token-nonce-ownership.js";
import { newUniswapTokenOperation, tokenAttempt, transitionUniswapToken, UniswapTokenJournal, type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN, verifyUniswapTokenUsdtState } from "../../src/swap/uniswap-v3/token-route.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { ETHEREUM_USDT, UNISWAP_V3_QUOTER_V2 } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { createTokenRpc, tokenBatch, type TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { UniswapTokenRpcBudgetJournal } from "../../src/swap/uniswap-v3/token-rpc-budget.js";
import { StateStore } from "../../src/state.js";
import { activateDirectPolicy, revokeDirectPolicy } from "./direct-allowlist-helpers.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const NOW = new Date("2026-09-22T00:00:00.000Z");
const clock = { now: () => NOW };

async function setup(root: string, daily = "1500000", account = ACCOUNT) {
  const admissions = [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({ chain: "eip155:1", kind: "token" as const,
    identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: daily,
    mechanism: UNISWAP_TOKEN_MECHANISM_PIN }));
  const policy = await activateDirectPolicy(root, "token-swap", { accounts: { evm: account }, admissions, now: NOW });
  const ledger = new AssetUsageLedger(root), usage = new UniswapTokenUsage(new StateStore(root), clock, ledger);
  return { ledger, usage, policy };
}

function operation(policyDigest: string, id: string, account = ACCOUNT, profile = "token-swap") {
  const gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  return newUniswapTokenOperation({ operationId: id.repeat(64), profile, account,
    route: createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: account,
      amountIn: "1000000", amountOutMinimum: "990000", deadline: 1_900_000_000 }), approvalCapAtomic: "1000000",
    allowanceAtPrepare: "0", approvalGas: gas, swapGas: gas, cleanupGas: gas, maximumNativeDebitWei: "600000",
    policyDigest, mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), now: NOW });
}
function quoteRequest() { return { command: "swap.uniswap-token.quote" as const, profile: "token-swap", account: ACCOUNT, recipient: ACCOUNT,
  sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000",
  approvalCapAtomic: "1000000", deadline: 1_900_000_000, maxApprovalGasLimit: "100000", maxSwapGasLimit: "100000",
  maxCleanupGasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1", maxNativeDebitWei: "600000" }; }

class FailOnceEffectJournal extends UniswapTokenEffectJournal {
  failed = false;
  override async seal(op: UniswapTokenOperation, kind: TokenEffectKind, transactionHash: Hex, envelope: object, now: Date) {
    if (!this.failed) { this.failed = true; throw new Error("injected post-wallet-save failure"); }
    return await super.seal(op, kind, transactionHash, envelope, now);
  }
}
async function production(root: string, now: Date, account: string, key: Hex, allowanceInput: string) {
  const state = new StateStore(root), master = Buffer.alloc(32, 73), wrapping = { load: async () => Buffer.from(master), create: async () => Buffer.from(master) };
  await state.initialize(); await new EncryptedWalletStore(state, wrapping).importNew("token-swap", key, account);
  let allowance = allowanceInput, phrase = "", observedTx: unknown = null, observedReceipt: unknown = null, finalizedSwap = false;
  const sends: Hex[] = [], word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
  let physical = 0, logical = 0; const rawCall = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getTransactionCount") return "0x7"; if (method === "eth_chainId") return "0x1";
    if (method === "eth_getCode") return "0x00";
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: `0x${"b".repeat(64)}`, baseFeePerGas: "0x0" };
    if (method === "eth_getBalance") return "0x100000";
    if (method === "eth_call") { const tx = params[0] as { data?: string; to?: string }, data = String(tx.data ?? ""), tag = String(params[1] ?? "");
      if (tx.to === UNISWAP_V3_QUOTER_V2) return `0x${word(1_000_000n).slice(2)}${word(0n).slice(2)}${word(0n).slice(2)}${word(0n).slice(2)}`;
      if (data.startsWith("0xdd62ed3e")) return word(BigInt(allowance));
      if (data.startsWith("0x70a08231")) { if (!finalizedSwap) return word(2_000_000n);
        if (tx.to === UNISWAP_USDC) return word(tag === "0x63" ? 2_000_000n : 1_000_000n);
        return word(tag === "0x63" ? 0n : 990_000n); }
      return "0x"; }
    if (method === "eth_estimateGas") return "0x5208"; if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_sendRawTransaction") { const raw = params[0] as Hex; sends.push(raw); return keccak256(raw); }
    if (method === "eth_getTransactionByHash") return observedTx; if (method === "eth_getTransactionReceipt") return observedReceipt; throw new Error(method);
  }; const call = (async (method: string, params: readonly unknown[]) => { physical += 1; logical += 1; return await rawCall(method, params); }) as TokenRpcCall;
  Object.defineProperty(call, "batch", { value: async (_route: string, items: readonly { method: string; params: readonly unknown[] }[]) => {
    physical += 1; logical += items.length; assert.ok(items.length <= 3); return await Promise.all(items.map((item) => rawCall(item.method, item.params))); } });
  const terminal = async () => ({ fd: 1, write: async (screen: string) => { phrase = /Type ([a-z0-9-]+) and/u.exec(screen)?.[1] ?? ""; },
    read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => undefined });
  let rpcNow = now.getTime(); const sessionCall = (maxHttpRequests: number) => createTokenRpc({ environment: {
    APN_ETHEREUM_RPC_URL: "https://rpc.example", APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example",
  }, state, now: () => rpcNow, pacingNow: () => rpcNow, wait: async (milliseconds) => { rpcNow += milliseconds; }, maxHttpRequests,
    deadlineMs: 300_000, transport: { request: async (_url, _method, body) => { const request = JSON.parse(body!); const rows = Array.isArray(request) ? request : [request];
      const response = await Promise.all(rows.map(async (row: any) => ({ jsonrpc: "2.0", id: row.id, result: await rawCall(row.method, row.params) })));
      return { status: 200, body: JSON.stringify(Array.isArray(request) ? response : response[0]) }; } } });
  const observe = (op: UniswapTokenOperation, kind: TokenEffectKind, status: 0 | 1) => { const attempt = kind === "approval" ? op.approvalAttempt! : kind === "swap" ? op.swapAttempt! : op.cleanupAttempt!, envelope = envelopeOf(op, kind, attempt.nonce), hash = attempt.transactionHash!;
    observedTx = { hash, chainId: "0x1", from: op.account, to: envelope.to, input: envelope.data, value: "0x0", nonce: `0x${BigInt(envelope.nonce).toString(16)}`,
      gas: `0x${BigInt(envelope.gasLimit).toString(16)}`, maxFeePerGas: `0x${BigInt(envelope.maxFeePerGas).toString(16)}`,
      maxPriorityFeePerGas: `0x${BigInt(envelope.maxPriorityFeePerGas).toString(16)}`, type: "0x2", blockNumber: "0x64", blockHash: `0x${"b".repeat(64)}` };
    observedReceipt = { transactionHash: hash, from: op.account, to: envelope.to, blockNumber: "0x64", blockHash: `0x${"b".repeat(64)}`,
      status: `0x${status}`, gasUsed: "0x5208", effectiveGasPrice: "0x1" }; finalizedSwap = kind === "swap" && status === 1; };
  return { state, wrapping, call, sends, setAllowance: (value: string) => { allowance = value; },
    counts: () => ({ physical, logical }), resetCounts: () => { physical = 0; logical = 0; }, sessionCall, observe,
    clearObservation: () => { observedTx = null; observedReceipt = null; finalizedSwap = false; }, tty: { isTerminal: () => true, openTerminal: terminal }, now };
}

test("token usage atomically enforces the daily source cap across concurrent operations", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root);
  const settled = await Promise.allSettled([s.usage.reserve(operation(s.policy.policyDigest, "a")), s.usage.reserve(operation(s.policy.policyDigest, "b"))]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await s.ledger.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, NOW)).amountAtomic, "1000000");
  await assert.rejects(s.usage.admitQuote(quoteRequest(), NOW), { code: "APN_OPERATION_BLOCKED" });
});

test("token usage is idempotent across restart and retains unknown principal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "2000000"), op = operation(s.policy.policyDigest, "c");
  const first = await s.usage.reserve(op), restarted = new UniswapTokenUsage(new StateStore(temporary.root), clock, new AssetUsageLedger(temporary.root));
  assert.deepEqual(await restarted.reserve(op), first);
  assert.equal((await restarted.follow(op, "unknown_finality")).state, "unknown_finality");
  assert.equal((await s.ledger.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, NOW)).amountAtomic, "1000000");
});

test("token usage finalizes consumed principal and releases only proven no-debit outcomes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "3000000");
  const success = operation(s.policy.policyDigest, "d"), reverted = operation(s.policy.policyDigest, "e"), preswap = operation(s.policy.policyDigest, "f");
  await s.usage.reserve(success); await s.usage.follow(success, "finalized");
  await s.usage.reserve(reverted); await s.usage.follow(reverted, "failed_confirmed_revert");
  await s.usage.reserve(preswap); await s.usage.follow(preswap, "failed_before_effect");
  assert.equal((await s.ledger.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, NOW)).amountAtomic, "1000000");
  assert.equal((await s.usage.current(success)).state, "finalized");
  assert.equal((await s.usage.current(reverted)).state, "failed_confirmed_revert");
  assert.equal((await s.usage.current(preswap)).state, "failed_before_effect");
});
test("ledger-terminal live split brain reconciles the operation to no-effect cleaned after restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "3000000"), journal = new UniswapTokenJournal(temporary.root);
  const prepared = await journal.save(operation(s.policy.policyDigest, "7")), usage = await s.usage.reserve(prepared);
  const approved = await journal.save(transitionUniswapToken(prepared, "approved", { usageReservationId: usage.reservationId, usageState: usage.state }, NOW));
  const started = await journal.save(transitionUniswapToken(approved, "approval_submission_started", { approvalAttempt: tokenAttempt(approved, "approval", "39", NOW) }, NOW));
  const split = await journal.save(transitionUniswapToken(started, "cleanup_required", { cleanupReason: "approval_pre_sign_failed" }, NOW));
  assert.equal((await s.usage.follow(split, "failed_before_effect")).state, "failed_before_effect");
  const never = async () => { throw new Error("no network or effect expected"); }, runtime = new UniswapTokenExecution(journal, {
    now: () => NOW, foregroundApprove: never, foregroundCleanup: never, withAccountLock: async <T>(_op: UniswapTokenOperation, work: () => Promise<T>) => await work(),
    allocateNonce: never, currentAllowance: never, releaseNonce: never, commitNonce: never, guard: never, revalidate: never,
    reserveUsage: async () => usage, currentUsage: async (op: UniswapTokenOperation) => await s.usage.current(op),
    followUsage: async (op: UniswapTokenOperation, target: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert") => await s.usage.follow(op, target),
    seal: never, probeSealed: async () => null, send: never, observe: never,
  } as any);
  const cleaned = await runtime.status(split.operationId); assert.equal(cleaned.phase, "cleaned"); assert.equal(cleaned.usageState, "failed_before_effect");
  assert.equal(cleaned.cleanupEvidence?.source, "legacy_usage_reconciliation"); assert.equal(cleaned.approvalAttempt?.transactionHash, null);
});

test("a refused token effect releases pending nonce 7 for the next valid operation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "3000000");
  const store = new UniswapTokenNonceStore(temporary.root), refused = operation(s.policy.policyDigest, "1"), valid = operation(s.policy.policyDigest, "2");
  assert.equal(await store.allocate(refused, "approval", 7n), "7"); assert.equal(await store.release(refused, "approval", "7"), true);
  assert.equal(await store.allocate(valid, "approval", 7n), "7");
});

test("restart reclaims pre-marker nonce but never reuses a committed ambiguous nonce", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "3000000");
  const first = operation(s.policy.policyDigest, "1"), replacement = operation(s.policy.policyDigest, "2"), afterAmbiguous = operation(s.policy.policyDigest, "3");
  assert.equal(await new UniswapTokenNonceStore(temporary.root).allocate(first, "approval", 7n), "7");
  const restarted = new UniswapTokenNonceStore(temporary.root); await restarted.reconcile(first.account, async () => null);
  assert.equal(await restarted.allocate(replacement, "approval", 7n), "7");
  await restarted.commit(replacement, "approval", "7");
  assert.equal(await new UniswapTokenNonceStore(temporary.root).allocate(afterAmbiguous, "approval", 7n), "8");
});

test("production token runtime allows explicit cleanup after owner policy revocation while new approval stays blocked", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const now = new Date(), key = `0x${"0".repeat(63)}1` as Hex,
    account = privateKeyToAccount(key).address, s = await setup(temporary.root, "3000000", account);
  const state = new StateStore(temporary.root), master = Buffer.alloc(32, 73), wrapping = { load: async () => Buffer.from(master), create: async () => Buffer.from(master) };
  await state.initialize(); await new EncryptedWalletStore(state, wrapping).importNew("token-swap", key, account);
  const journal = new UniswapTokenJournal(temporary.root), prepared = await journal.save(operation(s.policy.policyDigest, "8", account)), usage = await s.usage.reserve(prepared);
  const approved = await journal.save(transitionUniswapToken(prepared, "approved", { usageReservationId: usage.reservationId, usageState: usage.state }, now));
  const cleanupRequired = await journal.save(transitionUniswapToken(approved, "cleanup_required", { cleanupReason: "policy_drift" }, now));
  await revokeDirectPolicy(temporary.root, "token-swap", now);
  const blockHash = `0x${"b".repeat(64)}`, sends: Hex[] = [], word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
  const call = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: blockHash, baseFeePerGas: "0x0" };
    if (method === "eth_getBalance") return "0x100000";
    if (method === "eth_call") { const data = String((params[0] as { data?: string }).data ?? ""); return data.startsWith("0xdd62ed3e") ? word(1_000_000n) : "0x"; }
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_sendRawTransaction") { const raw = params[0] as Hex; sends.push(raw); return keccak256(raw); }
    if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") return null;
    throw new Error(method);
  };
  let phrase = ""; const terminal = async () => ({ fd: 1, write: async (screen: string) => { phrase = /Type ([a-z0-9-]+) and/u.exec(screen)?.[1] ?? ""; },
    read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => undefined });
  const runtime = createUniswapTokenRuntime({ state, wrapping, clock: { now: () => now }, call, foreground: "cleanup",
    tty: { isTerminal: () => true, openTerminal: terminal }, verifyPins: async () => undefined });
  const cleaned = await runtime.cleanup(cleanupRequired.operationId); assert.equal(cleaned.phase, "cleanup_submitted"); assert.equal(sends.length, 1);
  const approveRuntime = createUniswapTokenRuntime({ state, wrapping, clock: { now: () => now }, call, foreground: "approve",
    tty: { isTerminal: () => true, openTerminal: terminal }, verifyPins: async () => undefined });
  const newPrepared = await journal.save(operation(s.policy.policyDigest, "9", account)); await assert.rejects(approveRuntime.approve(newPrepared.operationId),
    (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === "swap_owner_admission_required");
});

test("production execute durably routes non-exact live allowance drift into explicit cleanup", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const now = new Date(), key = `0x${"0".repeat(63)}1` as Hex,
    account = privateKeyToAccount(key).address, s = await setup(temporary.root, "3000000", account), p = await production(temporary.root, now, account, key, "2");
  const journal = new UniswapTokenJournal(temporary.root), prepared = await journal.save(operation(s.policy.policyDigest, "4", account)), usage = await s.usage.reserve(prepared);
  const approved = await journal.save(transitionUniswapToken(prepared, "approved", { usageReservationId: usage.reservationId, usageState: usage.state }, now));
  const runtime = createUniswapTokenRuntime({ ...p, clock: { now: () => now }, foreground: "cleanup", verifyPins: async () => undefined });
  let op = await runtime.execute(approved.operationId); assert.equal(op.phase, "cleanup_required"); assert.equal(op.cleanupReason, "approval_allowance_drift");
  assert.equal(op.usageState, "reserved"); assert.equal(p.sends.length, 0);
  let budget = (await new UniswapTokenRpcBudgetJournal(temporary.root).load(op.operationId))!.rows.at(-1)!;
  assert.deepEqual([budget.cap, budget.requestSessionCap, budget.budgetClass], [14, 14, "approval_effect"]);
  op = await runtime.cleanup(op.operationId); assert.equal(op.phase, "cleanup_submitted"); assert.equal(op.usageState, "reserved"); assert.equal(p.sends.length, 1);
  budget = (await new UniswapTokenRpcBudgetJournal(temporary.root).load(op.operationId))!.rows.at(-1)!;
  assert.deepEqual([budget.cap, budget.requestSessionCap, budget.budgetClass], [0, 14, "recovery"]);
});

test("production token RPC phases stay within exact physical budgets through finalized swap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const at = new Date(), key = `0x${"0".repeat(63)}1` as Hex,
    account = privateKeyToAccount(key).address, s = await setup(temporary.root, "3000000", account), p = await production(temporary.root, at, account, key, "0");
  const pins = async (call: TokenRpcCall, tag: Hex) => { let cursor = 0;
    await tokenBatch(call, "archive", [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: (value) => value },
      ...Array.from({ length: 2 }, () => ({ method: "eth_getCode", params: [`0x${String(++cursor).padStart(40, "0")}`, tag], cachePolicy: "immutable" as const, decoder: (value: unknown) => value }))]);
    for (const size of [3, 3, 1]) await tokenBatch(call, "archive",
      Array.from({ length: size }, () => ({ method: "eth_getCode", params: [`0x${String(++cursor).padStart(40, "0")}`, tag], cachePolicy: "immutable", decoder: (value: unknown) => value }))); };
  const runtime = (call: TokenRpcCall, foreground: "approve" | "cleanup" | "refuse") => createUniswapTokenRuntime({ state: p.state, wrapping: p.wrapping,
    clock: { now: () => at }, call, foreground, tty: p.tty, verifyPins: pins });
  const request = { ...quoteRequest(), account, recipient: account, deadline: Math.floor(at.getTime() / 1000) + 600 };

  let call = p.sessionCall(8), quote = await runtime(call, "refuse").quote(request), telemetry = call.telemetry!()!;
  assert.deepEqual([telemetry.httpAttempts, telemetry.logicalItems], [8, 17]);
  call = p.sessionCall(9); let op = await runtime(call, "refuse").prepare({ command: "swap.uniswap-token.prepare", profile: "token-swap",
    quoteHash: (quote as { quoteHash: string }).quoteHash, idempotencyKey: "rpc-budget-sequence" }); telemetry = call.telemetry!()!;
  assert.deepEqual([telemetry.httpAttempts, telemetry.logicalItems], [9, 20]);

  call = p.sessionCall(14); op = await runtime(call, "approve").approve(op.operationId); telemetry = call.telemetry!()!;
  assert.equal(op.phase, "approval_submitted"); assert.deepEqual([telemetry.httpAttempts + call.effectAttempts!(), telemetry.logicalItems], [14, 25]);
  call = p.sessionCall(8); op = await runtime(call, "refuse").status(op.operationId); telemetry = call.telemetry!()!;
  assert.equal(op.phase, "approval_submitted"); assert.deepEqual([telemetry.httpAttempts, telemetry.logicalItems], [2, 4]);
  p.setAllowance("1000000"); p.observe(op, "approval", 1);
  call = p.sessionCall(8); op = await runtime(call, "refuse").status(op.operationId); telemetry = call.telemetry!()!;
  assert.equal(op.phase, "approval_observed"); assert.deepEqual([telemetry.httpAttempts, telemetry.logicalItems], [7, 10]);

  p.clearObservation(); call = p.sessionCall(24); op = await runtime(call, "refuse").execute(op.operationId); telemetry = call.telemetry!()!;
  assert.equal(op.phase, "submitted", op.cleanupReason ?? undefined); assert.deepEqual([telemetry.httpAttempts + call.effectAttempts!(), telemetry.logicalItems], [19, 32]);
  call = p.sessionCall(8); op = await runtime(call, "refuse").status(op.operationId); telemetry = call.telemetry!()!;
  assert.equal(op.phase, "submitted"); assert.deepEqual([telemetry.httpAttempts, telemetry.logicalItems], [2, 4]);
  p.setAllowance("0"); p.observe(op, "swap", 1);
  call = p.sessionCall(8); op = await runtime(call, "refuse").status(op.operationId); telemetry = call.telemetry!()!;
  assert.equal(op.phase, "observed"); assert.deepEqual([telemetry.httpAttempts, telemetry.logicalItems], [8, 14]);
  assert.equal(8 + 9 + 14 + 7 + 19 + 8, 65); assert.equal(65 + 2 + 2, 69); assert.equal(op.receipt?.inputDebitAtomic, "1000000");

  const journal = new UniswapTokenJournal(temporary.root), cleanupBase = await journal.save(operation(s.policy.policyDigest, "a", account)), usage = await s.usage.reserve(cleanupBase),
    cleanupOp = await journal.save(transitionUniswapToken(cleanupBase, "cleanup_required", { usageReservationId: usage.reservationId,
      usageState: usage.state, cleanupReason: "measured_cleanup" }, at));
  p.setAllowance("1000000"); p.clearObservation(); call = p.sessionCall(14); const cleanup = await runtime(call, "cleanup").cleanup(cleanupOp.operationId); telemetry = call.telemetry!()!;
  assert.equal(cleanup.phase, "cleanup_submitted"); assert.deepEqual([telemetry.httpAttempts + call.effectAttempts!(), telemetry.logicalItems], [14, 24]);
});

test("post-wallet-save journal failure commits nonce and restart repairs and broadcasts the cached effect once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const now = new Date(), key = `0x${"0".repeat(63)}1` as Hex,
    account = privateKeyToAccount(key).address, s = await setup(temporary.root, "3000000", account), p = await production(temporary.root, now, account, key, "0"),
    effects = new FailOnceEffectJournal(temporary.root), journal = new UniswapTokenJournal(temporary.root), prepared = await journal.save(operation(s.policy.policyDigest, "5", account)),
    usage = await s.usage.reserve(prepared), approved = await journal.save(transitionUniswapToken(prepared, "approved", { usageReservationId: usage.reservationId, usageState: usage.state }, now)),
    firstCustody = new UniswapTokenCustody(p.state, p.wrapping, p.call, () => now, effects);
  const ports = (custody: UniswapTokenCustody) => ({ now: () => now, foregroundApprove: async () => undefined, foregroundCleanup: async () => undefined,
    withAccountLock: async <T>(op: UniswapTokenOperation, work: () => Promise<T>) => await custody.withAccountLock(op, work),
    allocateNonce: async (op: UniswapTokenOperation, kind: TokenEffectKind) => await custody.allocateNonce(op, kind),
    releaseNonce: async (op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string) => { await custody.releaseNonce(op, kind, nonce); },
    commitNonce: async (op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string) => { await custody.commitNonce(op, kind, nonce); },
    currentAllowance: async (op: UniswapTokenOperation) => await custody.currentAllowance(op), guard: async () => undefined, revalidate: async () => undefined,
    reserveUsage: async (op: UniswapTokenOperation) => await s.usage.reserve(op), currentUsage: async (op: UniswapTokenOperation) => await s.usage.current(op),
    followUsage: async (op: UniswapTokenOperation, target: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert") => await s.usage.follow(op, target),
    seal: async (op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string) => await custody.seal(op, kind, nonce),
    probeSealed: async (op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string) => await custody.probeSealed(op, kind, nonce),
    send: async (op: UniswapTokenOperation, kind: TokenEffectKind) => await custody.send(op, kind), observe: async () => null });
  const first = new UniswapTokenExecution(journal, ports(firstCustody));
  await assert.rejects(first.execute(approved.operationId), /injected post-wallet-save failure/u); assert.equal(effects.failed, true);
  const interrupted = await journal.load(prepared.operationId); assert.equal(interrupted?.phase, "approval_submission_started");
  assert.equal(interrupted?.approvalAttempt?.nonce, "7"); assert.equal(interrupted?.approvalAttempt?.transactionHash, null); assert.equal(p.sends.length, 0);
  const other = operation(s.policy.policyDigest, "6", account), custody = new UniswapTokenCustody(p.state, p.wrapping, p.call, () => now);
  assert.equal(await custody.withAccountLock(other, async () => await custody.allocateNonce(other, "approval")), "8");
  const restarted = new UniswapTokenExecution(journal, ports(custody));
  let recovered = await restarted.execute(prepared.operationId); assert.equal(recovered.phase, "approval_submitted"); assert.equal(recovered.approvalAttempt?.nonce, "7");
  assert.match(recovered.approvalAttempt?.transactionHash ?? "", /^0x[a-f0-9]{64}$/u); assert.equal(p.sends.length, 1);
  recovered = await restarted.execute(prepared.operationId); assert.equal(recovered.phase, "approval_submitted"); assert.equal(p.sends.length, 1);
});

test("wallet-only hard crash keeps nonce occupied, repairs the journal, and sends once after restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const native = evmCore(temporary.root), wallet = await ensureDirectWallet(native);
  native.rpc.chainId = 1; native.rpc.sender = wallet.address; native.rpc.l1Fee = 0n; native.rpc.operatorFee = 0n; native.rpc.nonceAtomic = "7";
  const s = await setup(temporary.root, "3000000", wallet.address), token = operation(s.policy.policyDigest, "4", wallet.address, "default"),
    journal = new UniswapTokenJournal(temporary.root), effects = new FailOnceEffectJournal(temporary.root), sends: Hex[] = [];
  await journal.save(token); const call = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_sendRawTransaction") { const raw = params[0] as Hex; sends.push(raw); return keccak256(raw); }
    throw new Error(method);
  };
  const crashed = new UniswapTokenCustody(native.state, native.wrapping, call, () => NOW, effects);
  const nonce = await crashed.withAccountLock(token, async () => await crashed.allocateNonce(token, "approval")); assert.equal(nonce, "7");
  const started = await journal.save(transitionUniswapToken(token, "approval_submission_started", { usageReservationId: "b".repeat(64), usageState: "reserved",
    approvalAttempt: tokenAttempt(token, "approval", nonce, NOW) }, NOW));
  await assert.rejects(crashed.withAccountLock(started, async () => await crashed.seal(started, "approval", nonce)), /injected post-wallet-save failure/u);
  assert.equal(await new UniswapTokenEffectJournal(temporary.root).load(started, "approval"), null);
  assert.deepEqual(await occupiedUniswapTokenNonces(temporary.root, wallet.address), [7n]);
  const restartedNative = evmCore(temporary.root, native.rpc, native.wrapping, native.approval), prepared = await restartedNative.core.transfer.prepare({ ...EVM_REQUEST,
    asset: { chainId: 1, token: "native" }, amount: "0.000000000001", idempotencyKey: "wallet-only-crash-native-001" }) as { operation_id: string };
  assert.equal((await restartedNative.state.loadOperation(restartedNative.state.profileHash("default"), prepared.operation_id))?.economics?.nonceAtomic, "8");
  const recovered = new UniswapTokenCustody(restartedNative.state, native.wrapping, call, () => NOW);
  await recovered.withAccountLock(started, async () => { assert.equal(await recovered.allocateNonce(started, "approval"), "7");
    assert.ok(await new UniswapTokenEffectJournal(temporary.root).load(started, "approval")); await recovered.commitNonce(started, "approval", "7"); });
  assert.equal(await recovered.send(started, "approval"), "accepted"); assert.equal(sends.length, 1);
  await assert.rejects(recovered.send(started, "approval"), { code: "APN_OPERATION_BLOCKED" }); assert.equal(sends.length, 1);
});

test("token allocation and attempt persistence exclude a concurrent native prepare without deleting ownership", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const native = evmCore(temporary.root), wallet = await ensureDirectWallet(native);
  native.rpc.chainId = 1; native.rpc.sender = wallet.address; native.rpc.l1Fee = 0n; native.rpc.operatorFee = 0n; native.rpc.nonceAtomic = "7";
  const s = await setup(temporary.root, "3000000", wallet.address), token = operation(s.policy.policyDigest, "3", wallet.address, "default"), journal = new UniswapTokenJournal(temporary.root);
  await journal.save(token); const call = async (method: string) => { if (method === "eth_getTransactionCount") return "0x7"; throw new Error(method); };
  const custody = new UniswapTokenCustody(native.state, native.wrapping, call, () => NOW); let allocated!: () => void, persist!: () => void;
  const allocatedReady = new Promise<void>((resolve) => { allocated = resolve; }), mayPersist = new Promise<void>((resolve) => { persist = resolve; });
  const tokenWork = custody.withAccountLock(token, async () => { const nonce = await custody.allocateNonce(token, "approval"); allocated(); await mayPersist;
    await journal.save(transitionUniswapToken(token, "approval_submission_started", { usageReservationId: "b".repeat(64), usageState: "reserved",
      approvalAttempt: tokenAttempt(token, "approval", nonce, NOW) }, NOW)); return nonce; });
  await allocatedReady; assert.deepEqual(await occupiedUniswapTokenNonces(temporary.root, wallet.address), [7n]);
  const nativeWork = native.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: "native" }, amount: "0.000000000001",
    idempotencyKey: "token-native-race-001" }) as Promise<{ operation_id: string }>;
  persist(); assert.equal(await tokenWork, "7"); const prepared = await nativeWork;
  assert.deepEqual(await occupiedUniswapTokenNonces(temporary.root, wallet.address), [7n]);
  assert.equal((await native.state.loadOperation(native.state.profileHash("default"), prepared.operation_id))?.economics?.nonceAtomic, "8");
});

test("token and native custody share nonce ownership and preserve both encrypted effects across restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const native = evmCore(temporary.root), wallet = await ensureDirectWallet(native);
  native.rpc.chainId = 1; native.rpc.sender = wallet.address; native.rpc.l1Fee = 0n; native.rpc.operatorFee = 0n; native.rpc.nonceAtomic = "7";
  const prepared = await native.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: "native" },
    amount: "0.000000000001", idempotencyKey: "token-native-custody-001" }) as { operation_id: string };
  const token = operation("a".repeat(64), "7", wallet.address, "default"), call = async (method: string) => {
    if (method === "eth_getTransactionCount") return "0x7"; throw new Error(method); };
  const custody = new UniswapTokenCustody(native.state, native.wrapping, call, () => NOW);
  const tokenNonce = await custody.withAccountLock(token, async () => await custody.allocateNonce(token, "approval")); assert.equal(tokenNonce, "8");
  const started = transitionUniswapToken(token, "approval_submission_started", { usageReservationId: "b".repeat(64), usageState: "reserved",
    approvalAttempt: tokenAttempt(token, "approval", tokenNonce, NOW) }, NOW);
  const [, sealed] = await Promise.all([native.core.transfer.approve(prepared.operation_id),
    custody.withAccountLock(started, async () => await custody.seal(started, "approval", tokenNonce))]);
  assert.match(sealed.transactionHash, /^0x[a-f0-9]{64}$/u);
  const restarted = await new EncryptedWalletStore(new StateStore(temporary.root), native.wrapping).describe("default"); assert.ok(restarted);
  const effects = Object.values(restarted.secret.directEffects); assert.equal(effects.length, 2);
  assert.deepEqual(effects.map((effect) => Number(parseTransaction(effect.rawTransaction).nonce)).sort(), [7, 8]);
  new EncryptedWalletStore(new StateStore(temporary.root), native.wrapping).clear(restarted.secret);
});

test("native prepare skips a sealed token nonce after restart and both effects survive", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const native = evmCore(temporary.root), wallet = await ensureDirectWallet(native);
  native.rpc.chainId = 1; native.rpc.sender = wallet.address; native.rpc.l1Fee = 0n; native.rpc.operatorFee = 0n; native.rpc.nonceAtomic = "7";
  const token = operation("a".repeat(64), "6", wallet.address, "default"), journal = new UniswapTokenJournal(temporary.root);
  await journal.save(token); const call = async (method: string) => { if (method === "eth_getTransactionCount") return "0x7"; throw new Error(method); };
  const custody = new UniswapTokenCustody(native.state, native.wrapping, call, () => NOW), nonce = await custody.withAccountLock(token,
    async () => await custody.allocateNonce(token, "approval")); assert.equal(nonce, "7");
  const started = await journal.save(transitionUniswapToken(token, "approval_submission_started", { usageReservationId: "b".repeat(64), usageState: "reserved",
    approvalAttempt: tokenAttempt(token, "approval", nonce, NOW) }, NOW));
  await custody.withAccountLock(started, async () => { await custody.seal(started, "approval", nonce); await custody.commitNonce(started, "approval", nonce); });
  const restarted = evmCore(temporary.root, native.rpc, native.wrapping, native.approval), prepared = await restarted.core.transfer.prepare({ ...EVM_REQUEST,
    asset: { chainId: 1, token: "native" }, amount: "0.000000000001", idempotencyKey: "token-owned-native-next-001" }) as { operation_id: string };
  const record = await restarted.state.loadOperation(restarted.state.profileHash("default"), prepared.operation_id); assert.equal(record?.economics?.nonceAtomic, "8");
  await restarted.core.transfer.approve(prepared.operation_id); const loaded = await new EncryptedWalletStore(restarted.state, native.wrapping).describe("default"); assert.ok(loaded);
  assert.deepEqual(Object.values(loaded.secret.directEffects).map((effect) => Number(parseTransaction(effect.rawTransaction).nonce)).sort(), [7, 8]);
  new EncryptedWalletStore(restarted.state, native.wrapping).clear(loaded.secret);
});

test("native pre-sign refuses when its frozen nonce becomes token-owned", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const native = evmCore(temporary.root), wallet = await ensureDirectWallet(native);
  native.rpc.chainId = 1; native.rpc.sender = wallet.address; native.rpc.l1Fee = 0n; native.rpc.operatorFee = 0n; native.rpc.nonceAtomic = "7";
  const prepared = await native.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: "native" }, amount: "0.000000000001",
    idempotencyKey: "native-token-conflict-001" }) as { operation_id: string };
  const token = operation("a".repeat(64), "5", wallet.address, "default"), journal = new UniswapTokenJournal(temporary.root); await journal.save(token);
  const call = async (method: string) => { if (method === "eth_getTransactionCount") return "0x7"; throw new Error(method); };
  const custody = new UniswapTokenCustody(native.state, native.wrapping, call, () => NOW), store = new UniswapTokenNonceStore(temporary.root); let started!: UniswapTokenOperation;
  await custody.withAccountLock(token, async () => { assert.equal(await store.allocate(token, "approval", 7n), "7");
    started = await journal.save(transitionUniswapToken(token, "approval_submission_started", { usageReservationId: "b".repeat(64), usageState: "reserved",
      approvalAttempt: tokenAttempt(token, "approval", "7", NOW) }, NOW));
    await custody.seal(started, "approval", "7"); await custody.commitNonce(started, "approval", "7"); });
  await assert.rejects(native.core.transfer.approve(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  const refused = await native.state.loadOperation(native.state.profileHash("default"), prepared.operation_id);
  assert.equal(refused?.state, "failed_before_effect"); assert.equal(refused?.transitions.some((transition) => transition.state === "started"), false);
  const loaded = await new EncryptedWalletStore(native.state, native.wrapping).describe("default"); assert.ok(loaded);
  assert.equal(Object.values(loaded.secret.directEffects).length, 1); assert.equal(parseTransaction(Object.values(loaded.secret.directEffects)[0]!.rawTransaction).nonce, 7);
  new EncryptedWalletStore(native.state, native.wrapping).clear(loaded.secret); assert.equal(native.rpc.submissions.length, 0);
});

test("signer-time token nonce race releases native usage only after proving no signed effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); let inject: (() => Promise<void>) | null = null, signerCalls = 0;
  const native = evmCore(temporary.root, undefined, undefined, undefined, (port) => ({ request: async (request) => {
    if (request.operation === "directTransfer.approveAndSign") { signerCalls += 1; const race = inject; inject = null; await race?.(); }
    return await port.request(request);
  } }));
  native.rpc.chainId = 1; native.rpc.l1Fee = 0n; native.rpc.operatorFee = 0n; const wallet = await ensureDirectWallet(native); native.rpc.sender = wallet.address;
  const prepared = await native.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: "native" }, amount: "0.000000000001",
    idempotencyKey: "native-signer-token-race-001" }) as { operation_id: string };
  const frozen = await native.state.loadOperation(native.state.profileHash("default"), prepared.operation_id); assert.ok(frozen?.economics);
  const token = operation("a".repeat(64), "2", wallet.address, "default"), store = new UniswapTokenNonceStore(temporary.root);
  inject = async () => { assert.equal(await store.allocate(token, "approval", BigInt(frozen.economics!.nonceAtomic)), frozen.economics!.nonceAtomic); };
  await assert.rejects(native.core.transfer.approve(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  const failed = await native.state.loadOperation(native.state.profileHash("default"), prepared.operation_id); assert.ok(failed?.allowlistLease);
  assert.equal(failed.state, "failed_before_effect"); assert.equal(failed.terminal, true); assert.equal(failed.reason, "native_signer_reprepare_required");
  assert.equal(failed.transactionHash, undefined); assert.equal(failed.rawTransactionHash, undefined); assert.equal(signerCalls, 1); assert.equal(native.rpc.submissions.length, 0);
  const secret = await new EncryptedWalletStore(native.state, native.wrapping).describe("default"); assert.ok(secret); assert.equal(Object.keys(secret.secret.directEffects).length, 0);
  new EncryptedWalletStore(native.state, native.wrapping).clear(secret.secret); const reservation = failed.allowlistLease.reservation;
  const ledger = await new AssetUsageLedger(temporary.root).load({ account: reservation.account, chain: reservation.chain, asset: reservation.asset }, reservation.reservationId);
  assert.equal(ledger?.state, "failed_before_effect");
  assert.equal((await native.core.transfer.approve(prepared.operation_id) as { state: string }).state, "failed_before_effect"); assert.equal(signerCalls, 1);
  const restarted = evmCore(temporary.root, native.rpc, native.wrapping);
  assert.equal((await restarted.core.transfer.approve(prepared.operation_id) as { state: string }).state, "failed_before_effect");
  assert.equal((await new AssetUsageLedger(temporary.root).load({ account: reservation.account, chain: reservation.chain, asset: reservation.asset }, reservation.reservationId))?.state, "failed_before_effect");
  assert.equal(native.rpc.submissions.length, 0);
});

test("reprepare classification after native effect persistence remains recoverable and reserved", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const native = evmCore(temporary.root, undefined, undefined, undefined, (port) => ({ request: async (request) => {
    const result = await port.request(request);
    if (request.operation === "directTransfer.approveAndSign") throw new ApnError("APN_REPREPARE_REQUIRED", "injected after effect persistence");
    return result;
  } }));
  native.rpc.chainId = 1; native.rpc.l1Fee = 0n; native.rpc.operatorFee = 0n; const wallet = await ensureDirectWallet(native); native.rpc.sender = wallet.address;
  const prepared = await native.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: "native" }, amount: "0.000000000001",
    idempotencyKey: "native-post-marker-reprepare-001" }) as { operation_id: string };
  await assert.rejects(native.core.transfer.approve(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  const started = await native.state.loadOperation(native.state.profileHash("default"), prepared.operation_id); assert.equal(started?.state, "started");
  const reservation = started?.allowlistLease?.reservation; assert.ok(reservation);
  assert.equal((await new AssetUsageLedger(temporary.root).load({ account: reservation.account, chain: reservation.chain, asset: reservation.asset }, reservation.reservationId))?.state, "reserved");
  const secret = await new EncryptedWalletStore(native.state, native.wrapping).describe("default"); assert.ok(secret); assert.equal(Object.keys(secret.secret.directEffects).length, 1);
  new EncryptedWalletStore(native.state, native.wrapping).clear(secret.secret);
  const restarted = evmCore(temporary.root, native.rpc, native.wrapping); assert.equal((await restarted.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal(native.rpc.submissions.length, 1);
});

test("token USDT behavior pins reject deprecated and fee-bearing state", async () => {
  const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
  const verify = async (values: readonly bigint[]) => { let index = 0;
    await verifyUniswapTokenUsdtState(async (method) => { assert.equal(method, "eth_call"); return word(values[index++]!); }, "0x64"); };
  await verify([0n, 0n, 0n]);
  for (const values of [[1n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]] as const) {
    await assert.rejects(verify(values), (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === "uniswap_code_pin_drift");
  }
});
