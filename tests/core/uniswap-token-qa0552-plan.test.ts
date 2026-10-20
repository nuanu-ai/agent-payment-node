import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { ApnError } from "../../src/errors.js";
import { StateStore } from "../../src/state.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { UniswapTokenExecution, type TokenEffectKind } from "../../src/swap/uniswap-v3/token-execution.js";
import { newUniswapTokenOperation, tokenAttempt, transitionUniswapToken, UniswapTokenJournal, type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { occupiedUniswapTokenNonces } from "../../src/swap/uniswap-v3/token-nonce-ownership.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import type { TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { UniswapTokenRpcBudgetJournal } from "../../src/swap/uniswap-v3/token-rpc-budget.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { UNISWAP_TOKEN_EXECUTE_PLAN, uniswapTokenProbedCap } from "../../src/swap/uniswap-v3/token-runtime.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { movingNode, pinsLikeProduction, tokenSession, typingTerminal, WRAPPING } from "./uniswap-token-qa0552-harness.js";

const KEY = `0x${"0".repeat(63)}5` as Hex, ACCOUNT = privateKeyToAccount(KEY).address, PROFILE = "qa0552-token";
/** The captured live operation's caps (fresh quote 867244e9…): 1 USDC for at least 0.98 USDT, 0.4 gwei / 0.05 gwei, 0.00015 ETH. */
const LIVE = (JSON.parse(readFileSync("tests/core/fixtures/uniswap-token-qa0552.json", "utf8")) as { stranded: { operation: UniswapTokenOperation } }).stranded.operation;

async function production(root: string, pooled = false) {
  const at = new Date(), state = new StateStore(root); await state.initialize();
  await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
  await activateDirectPolicy(root, PROFILE, { accounts: { evm: ACCOUNT }, now: at, admissions: [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({
    chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "3000000",
    mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
  const chain = movingNode({ account: ACCOUNT, allowance: "0", pending: 9n }), terminal = typingTerminal();
  const run = (maxHttpRequests: number, foreground: "approve" | "cleanup" | "refuse" = "refuse") => {
    const call = tokenSession(state, chain, maxHttpRequests, pooled);
    return { call, runtime: createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock: { now: () => at }, call, foreground, tty: terminal.tty, verifyPins: pinsLikeProduction }) };
  };
  const posts = (call: TokenRpcCall) => call.telemetry!()!.httpAttempts + call.effectAttempts!();
  /** quote → prepare → owner approval → the approval lands → status sees it: the state execute starts from. */
  const approvalObserved = async (idempotencyKey: string) => {
    let step = run(8); const quote = await step.runtime.quote({ command: "swap.uniswap-token.quote", profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT,
      sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: LIVE.route.amountIn, minimumOutputAtomic: LIVE.route.amountOutMinimum,
      approvalCapAtomic: LIVE.approvalCapAtomic, deadline: Math.floor(at.getTime() / 1000) + 600, maxApprovalGasLimit: LIVE.approvalGas.gasLimit,
      maxSwapGasLimit: LIVE.swapGas.gasLimit, maxCleanupGasLimit: LIVE.cleanupGas.gasLimit, maxFeePerGas: LIVE.swapGas.maxFeePerGas,
      maxPriorityFeePerGas: LIVE.swapGas.maxPriorityFeePerGas, maxNativeDebitWei: LIVE.maximumNativeDebitWei }) as { quoteHash: string };
    step = run(9); let op = await step.runtime.prepare({ command: "swap.uniswap-token.prepare", profile: PROFILE, quoteHash: quote.quoteHash, idempotencyKey });
    step = run(14, "approve"); op = await step.runtime.approve(op.operationId); assert.equal(op.phase, "approval_submitted");
    chain.land(chain.node.sends.at(-1)!, chain.node.head - 5n); chain.node.allowance = LIVE.route.amountIn;
    step = run(11); op = await step.runtime.status(op.operationId); assert.equal(op.phase, "approval_observed"); return op;
  };
  return { at, state, chain, run, posts, approvalObserved };
}

test("QA 0.5.52: a USDC→USDT execute reads every guard fact once at one block and fits its plan with the send (moving chain)", async (t) => {
  for (const pooled of [false, true]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup); const p = await production(temporary.root, pooled);
    const observed = await p.approvalObserved(`plan-${pooled}`), cap = uniswapTokenProbedCap(UNISWAP_TOKEN_EXECUTE_PLAN, pooled ? 1 : 0);
    assert.equal(cap, 15); p.chain.node.methods.length = 0;
    const { call, runtime } = p.run(cap), op = await runtime.execute(observed.operationId), telemetry = call.telemetry!()!;
    assert.deepEqual([op.phase, op.swapAttempt?.nonce, p.chain.node.sends.length], ["submitted", "10", 2], op.cleanupReason ?? undefined);
    // nonce 1, signing block 1, pins 4, state 1, simulation 1, gas with recheck 1, fees with recheck 1, send 1, observation 2.
    assert.equal(p.posts(call), 13, JSON.stringify(telemetry));
    const methods = p.chain.node.methods, count = (method: string) => methods.filter((row) => row === method).length;
    assert.deepEqual([count("eth_getCode"), count("eth_getStorageAt"), count("eth_estimateGas"), count("eth_getTransactionCount")], [5, 1, 1, 2],
      "the code pins, the gas estimate and the nonce reads happen once each (the pending nonce: reserve, then the guard's check)");
    // Archive: the pins (scalar: the chain id rides in their first batch; pooled: the anchor batch), the state batch, the
    // simulation and the receipt lookup this transport routes there. The live failure spent 17 archive attempts before its send.
    assert.deepEqual(telemetry.attemptsByEndpointRole, { primary: 5, receipt: 0, archive: 7 }, JSON.stringify(telemetry));
    const signed = parseTransaction(p.chain.node.sends[1]!);
    assert.deepEqual([signed.nonce, signed.to?.toLowerCase(), signed.data], [10, op.route.router.toLowerCase(), op.route.calldata]);
    const row = (await new UniswapTokenRpcBudgetJournal(temporary.root).load(op.operationId))!.rows.at(-1)!;
    assert.deepEqual([row.command, row.cap, row.requestSessionCap, row.budgetClass, row.physicalRequests], ["swap.uniswap-token.execute", cap, cap, "swap_effect", 13]);
  }
});

test("QA 0.5.52: an approval that execute resumes from approved fits the same plan", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const p = await production(temporary.root);
  const journal = new UniswapTokenJournal(temporary.root);
  let step = p.run(8); const quote = await step.runtime.quote({ command: "swap.uniswap-token.quote", profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT,
    sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "980000", approvalCapAtomic: "1000000",
    deadline: Math.floor(p.at.getTime() / 1000) + 600, maxApprovalGasLimit: "100000", maxSwapGasLimit: "200000", maxCleanupGasLimit: "70000",
    maxFeePerGas: "400000000", maxPriorityFeePerGas: "50000000", maxNativeDebitWei: "150000000000000" }) as { quoteHash: string };
  step = p.run(9); let op = await step.runtime.prepare({ command: "swap.uniswap-token.prepare", profile: PROFILE, quoteHash: quote.quoteHash, idempotencyKey: "resume-approval" });
  // The owner approved (consent and the usage hold), then the command stopped before the approval effect started.
  const usage = await new UniswapTokenUsage(p.state, { now: () => p.at }, new AssetUsageLedger(temporary.root)).reserve(op);
  op = await journal.save(transitionUniswapToken(op, "approved", { usageReservationId: usage.reservationId, usageState: usage.state }, p.at));

  // Capacity for the send is taken before any marker: with room only for the allowance read, nothing is reserved or written.
  step = p.run(1); await assert.rejects(step.runtime.execute(op.operationId), (error: ApnError) => error.code === "APN_RPC_BUDGET_EXCEEDED" &&
    error.details?.rpcMethod === "eth_sendRawTransaction");
  const untouched = await journal.load(op.operationId); assert.deepEqual([untouched?.phase, untouched?.approvalAttempt, untouched?.integrityHash], ["approved", null, op.integrityHash]);
  assert.equal(p.chain.node.sends.length, 0);
  assert.deepEqual(await occupiedUniswapTokenNonces(temporary.root, ACCOUNT), []);

  step = p.run(uniswapTokenProbedCap(UNISWAP_TOKEN_EXECUTE_PLAN, 0)); op = await step.runtime.execute(op.operationId);
  assert.deepEqual([op.phase, op.approvalAttempt?.nonce, p.chain.node.sends.length], ["approval_submitted", "9", 1]);
  assert.equal(p.posts(step.call), 14, "allowance 1, nonce 1, block 1, pins 4, state 1, simulation 1, gas 1, fees 1, send 1, observation 2");
});

test("QA 0.5.52: guard reads that run out of budget refuse before custody with a recorded diagnostic, a freed nonce and the hold kept for cleanup", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const p = await production(temporary.root);
  const observed = await p.approvalObserved("starved"), sends = p.chain.node.sends.length;
  const { runtime } = p.run(6), op = await runtime.execute(observed.operationId);
  assert.deepEqual([op.phase, op.cleanupReason, op.swapAttempt, op.usageState], ["cleanup_required", "post_approval_revalidation_failed", null, "reserved"]);
  assert.deepEqual([op.preSignFailure?.code, op.preSignFailure?.reason, op.preSignFailure?.phase], ["APN_RPC_BUDGET_EXCEEDED", "maxHttpAttempts", "submission_started"]);
  assert.equal(p.chain.node.sends.length, sends, "nothing signed or sent");
  const wallet = await new EncryptedWalletStore(p.state, WRAPPING).describe(PROFILE);
  assert.equal(Object.keys(wallet!.secret.directEffects).length, 1, "custody holds only the approval's signed bytes"); new EncryptedWalletStore(p.state, WRAPPING).clear(wallet!.secret);
  const nonces = await occupiedUniswapTokenNonces(temporary.root, ACCOUNT);
  assert.deepEqual(nonces, [9n], "the swap's nonce 10 is free again; the approval keeps 9");
});

test("execution: a refused send slot leaves no marker, no nonce and no hold change; a refusal inside the guard is recorded before custody", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const journal = new UniswapTokenJournal(temporary.root);
  const base = approvalObservedRecord(); await journal.save(base);
  const calls: string[] = []; let refuseSlot = true;
  const ports = { now: () => new Date(base.updatedAt), foregroundApprove: async () => undefined, foregroundCleanup: async () => undefined,
    withAccountLock: async <T>(_op: UniswapTokenOperation, work: () => Promise<T>) => await work(),
    reserveSendCapacity: () => { calls.push("slot"); if (refuseSlot) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Bridge RPC command budget exhausted.", { reason: "maxHttpAttempts", rpcMethod: "eth_sendRawTransaction" }); },
    allocateNonce: async (_op: UniswapTokenOperation, kind: TokenEffectKind) => { calls.push(`nonce:${kind}`); return "10"; },
    releaseNonce: async (_op: UniswapTokenOperation, kind: TokenEffectKind) => { calls.push(`release:${kind}`); return true; }, commitNonce: async () => undefined,
    currentAllowance: async () => base.route.amountIn, reserveUsage: async () => { throw new Error("held already"); },
    guard: async () => { calls.push("guard"); throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Bridge RPC command budget exhausted.", { reason: "maxHttpAttempts", rpcMethod: "eth_getCode" }); },
    currentUsage: async (op: UniswapTokenOperation) => ({ reservationId: op.usageReservationId!, state: op.usageState! }),
    followUsage: async () => { throw new Error("no usage move"); }, seal: async () => { calls.push("seal"); throw new Error("must not sign"); },
    probeSealed: async () => null, send: async () => { calls.push("send"); return "accepted" as const; }, observe: async () => null };
  await assert.rejects(new UniswapTokenExecution(journal, ports).execute(base.operationId), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.deepEqual(calls, ["slot"]); assert.equal((await journal.load(base.operationId))?.integrityHash, base.integrityHash);
  refuseSlot = false; calls.length = 0; const op = await new UniswapTokenExecution(journal, ports).execute(base.operationId);
  assert.deepEqual(calls, ["slot", "nonce:swap", "guard", "release:swap"]);
  assert.deepEqual([op.phase, op.swapAttempt, op.usageState, op.preSignFailure], ["cleanup_required", null, "reserved",
    { code: "APN_RPC_BUDGET_EXCEEDED", reason: "maxHttpAttempts", rpcMethod: "eth_getCode", endpointRole: null, phase: "submission_started" }]);
});

test("execution: a stranded hashless swap marker is settled by execute through custody, and the next execute signs once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const journal = new UniswapTokenJournal(temporary.root);
  const observed = await journal.save(approvalObservedRecord()), at = new Date(observed.updatedAt), calls: string[] = [];
  const stranded = await journal.save(transitionUniswapToken(observed, "submission_started", { swapAttempt: tokenAttempt(observed, "swap", "10", at) }, at));
  const ports = { now: () => at, foregroundApprove: async () => undefined, foregroundCleanup: async () => undefined,
    withAccountLock: async <T>(_op: UniswapTokenOperation, work: () => Promise<T>) => { calls.push("lock"); return await work(); },
    reserveSendCapacity: () => { calls.push("slot"); }, allocateNonce: async () => { calls.push("nonce"); return "11"; },
    releaseNonce: async (_op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string) => { calls.push(`release:${kind}:${nonce}`); return true; },
    commitNonce: async () => undefined, currentAllowance: async () => observed.route.amountIn, reserveUsage: async () => { throw new Error("held already"); },
    guard: async () => { calls.push("guard"); }, currentUsage: async (op: UniswapTokenOperation) => ({ reservationId: op.usageReservationId!, state: op.usageState! }),
    followUsage: async (op: UniswapTokenOperation, state: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" | "released_unsubmitted") =>
      ({ reservationId: op.usageReservationId!, state }),
    seal: async (_op: UniswapTokenOperation, _kind: TokenEffectKind, nonce: string) => { calls.push(`seal:${nonce}`); return { transactionHash: `0x${"2".repeat(64)}`, envelopeHash: "e".repeat(64) }; },
    probeSealed: async () => null, recoverSealed: async () => null, send: async () => { calls.push("send"); return "accepted" as const; }, observe: async () => null };
  let op = await new UniswapTokenExecution(journal, ports).execute(stranded.operationId);
  assert.deepEqual([op.phase, op.swapAttempt, calls], ["approval_observed", null, ["lock", "release:swap:10"]], "nothing signed while the marker is settled");
  calls.length = 0; op = await new UniswapTokenExecution(journal, ports).execute(op.operationId);
  assert.deepEqual([op.phase, op.swapAttempt?.nonce, calls], ["submitted", "11", ["lock", "slot", "nonce", "guard", "seal:11", "slot", "send"]]);
});

/** An approval_observed swap shaped like the captured one (same caps, approval nonce 9 landed), before its swap starts. */
function approvalObservedRecord(): UniswapTokenOperation {
  const at = new Date("2026-10-20T08:06:00.000Z");
  let op = newUniswapTokenOperation({ operationId: "c".repeat(64), profile: PROFILE, account: ACCOUNT, route: createUniswapTokenRoute({ inputToken: UNISWAP_USDC,
    outputToken: ETHEREUM_USDT, recipient: ACCOUNT, amountIn: LIVE.route.amountIn, amountOutMinimum: LIVE.route.amountOutMinimum, deadline: Math.floor(at.getTime() / 1000) + 1_200 }),
  approvalCapAtomic: LIVE.approvalCapAtomic, allowanceAtPrepare: "0", approvalGas: LIVE.approvalGas, swapGas: LIVE.swapGas, cleanupGas: LIVE.cleanupGas,
  maximumNativeDebitWei: LIVE.maximumNativeDebitWei, policyDigest: "d".repeat(64), mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), now: at });
  op = transitionUniswapToken(op, "approved", { usageReservationId: "e".repeat(64), usageState: "reserved" }, at);
  const approval = tokenAttempt(op, "approval", "9", at);
  op = transitionUniswapToken(op, "approval_submission_started", { approvalAttempt: approval }, at);
  op = transitionUniswapToken(op, "approval_submitted", { approvalAttempt: { ...approval, transactionHash: LIVE.approvalAttempt!.transactionHash } }, at);
  return transitionUniswapToken(op, "approval_observed", { accumulatedNativeDebitWei: LIVE.accumulatedNativeDebitWei }, at);
}
