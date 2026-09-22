import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { UniswapTokenCustody } from "../../src/swap/uniswap-v3/token-custody.js";
import { UniswapTokenNonceStore } from "../../src/swap/uniswap-v3/token-nonce.js";
import { newUniswapTokenOperation, tokenAttempt, transitionUniswapToken, UniswapTokenJournal } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN, verifyUniswapTokenUsdtState } from "../../src/swap/uniswap-v3/token-route.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
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

test("a refused token effect releases pending nonce 7 for the next valid operation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "3000000");
  const store = new UniswapTokenNonceStore(temporary.root), refused = operation(s.policy.policyDigest, "1"), valid = operation(s.policy.policyDigest, "2"), noEffect = async () => false;
  assert.equal(await store.allocate(refused, "approval", 7n, noEffect), "7"); assert.equal(await store.release(refused, "approval", "7", noEffect), true);
  assert.equal(await store.allocate(valid, "approval", 7n, noEffect), "7");
});

test("restart reclaims pre-marker nonce but never reuses a committed ambiguous nonce", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "3000000"), noEffect = async () => false;
  const first = operation(s.policy.policyDigest, "1"), replacement = operation(s.policy.policyDigest, "2"), afterAmbiguous = operation(s.policy.policyDigest, "3");
  assert.equal(await new UniswapTokenNonceStore(temporary.root).allocate(first, "approval", 7n, noEffect), "7");
  const restarted = new UniswapTokenNonceStore(temporary.root); assert.equal(await restarted.allocate(replacement, "approval", 7n, noEffect), "7");
  await restarted.commit(replacement, "approval", "7");
  assert.equal(await new UniswapTokenNonceStore(temporary.root).allocate(afterAmbiguous, "approval", 7n, noEffect), "8");
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
  const store = new UniswapTokenNonceStore(temporary.root), noEffect = async () => false; assert.equal(await store.allocate(token, "approval", 7n, noEffect), "7");
  const started = await journal.save(transitionUniswapToken(token, "approval_submission_started", { usageReservationId: "b".repeat(64), usageState: "reserved",
    approvalAttempt: tokenAttempt(token, "approval", "7", NOW) }, NOW));
  const call = async (method: string) => { if (method === "eth_getTransactionCount") return "0x7"; throw new Error(method); };
  const custody = new UniswapTokenCustody(native.state, native.wrapping, call, () => NOW);
  await custody.withAccountLock(started, async () => { await custody.seal(started, "approval", "7"); await custody.commitNonce(started, "approval", "7"); });
  await assert.rejects(native.core.transfer.approve(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal(native.rpc.submissions.length, 0);
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
