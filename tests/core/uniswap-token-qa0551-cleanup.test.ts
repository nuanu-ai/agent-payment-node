import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keccak256, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { domainHash } from "../../src/canonical.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { ApnError } from "../../src/errors.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { envelopeOf, UniswapTokenCustody } from "../../src/swap/uniswap-v3/token-custody.js";
import { UniswapTokenEffectJournal } from "../../src/swap/uniswap-v3/token-effects.js";
import { requotedCleanup, UniswapTokenExecution, type TokenEffectKind, type TokenEffectObservation, type UniswapTokenExecutionPorts } from "../../src/swap/uniswap-v3/token-execution.js";
import { UniswapTokenNonceStore } from "../../src/swap/uniswap-v3/token-nonce.js";
import { newUniswapTokenOperation, tokenAttempt, transitionUniswapToken, UniswapTokenJournal, validateUniswapTokenOperation,
  type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { executeUniswapCommand, uniswapTokenNextActions } from "../../src/swap/uniswap-command-service.js";
import { bindArgv } from "../../src/command-binder.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { StateStore } from "../../src/state.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

/** QA 0.5.51: two Ethereum token swaps refused the swap before signing (fee cap), then their consented cleanup failed as state corruption. */
const LIVE = JSON.parse(readFileSync("tests/core/fixtures/uniswap-token-qa0551-cleanup.json", "utf8")) as {
  operations: UniswapTokenOperation[]; chain: Record<string, { allowanceAtomic: string; pendingNonce: string;
    reservations: { kind: TokenEffectKind; nonce: string; operationId: string; state: "reserved" | "committed" }[] }> };
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`, H = (c: string) => `0x${c.repeat(64)}`;
const FEE_CAP = new ApnError("APN_OPERATION_BLOCKED", "Current EIP-1559 fees exceed the approved caps.", { reason: "uniswap_token_fee_cap" });
const MASTER = Buffer.alloc(32, 73), WRAPPING = { load: async () => Buffer.from(MASTER), create: async () => Buffer.from(MASTER) };

/** The state the failed cleanup left: the record as captured and the exact nonce reservations (approval committed, cleanup reserved). */
async function seedLive(root: string, record: UniswapTokenOperation) {
  const state = new StateStore(root); await state.initialize();
  const journal = new UniswapTokenJournal(root), op = await journal.save(validateUniswapTokenOperation(record)), nonces = new UniswapTokenNonceStore(root);
  for (const row of LIVE.chain[op.operationId]!.reservations) {
    assert.equal(await nonces.allocate(op, row.kind, BigInt(row.nonce)), row.nonce);
    if (row.state === "committed") await nonces.commit(op, row.kind, row.nonce);
  }
  return { state, journal, op };
}
function reservations(root: string, account: string) {
  const raw = JSON.parse(readFileSync(`${root}/uniswap-token-nonces/${domainHash("apn.uniswap-token-nonce-account.v1", account)}.json`, "utf8"));
  return Object.values(raw.reservations as Record<string, { kind: string; nonce: string; state: string }>).map((row) => `${row.kind}:${row.nonce}:${row.state}`).sort();
}

/** Real journal, nonce store and account custody (nonce reservation, release, commit, allowance); a fake chain and signer. */
function livePorts(root: string, state: StateStore, chain: { allowance: string; pending: string; guard: unknown; observation: TokenEffectObservation | null },
  counts: { consent: number; seal: number; sends: TokenEffectKind[] }) {
  const call = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getTransactionCount") return `0x${BigInt(chain.pending).toString(16)}`;
    if (method === "eth_call" && String((params[0] as { data?: string }).data).startsWith("0xdd62ed3e")) return word(BigInt(chain.allowance));
    throw new Error(`unexpected ${method}`);
  };
  const custody = new UniswapTokenCustody(state, WRAPPING, call, () => new Date()), effects = new UniswapTokenEffectJournal(root);
  const ports: UniswapTokenExecutionPorts = { now: () => new Date(), foregroundApprove: async () => { throw new Error("no approval"); },
    foregroundCleanup: async () => { counts.consent += 1; }, withAccountLock: async (op, work) => await custody.withAccountLock(op, work),
    allocateNonce: async (op, kind) => await custody.allocateNonce(op, kind), currentAllowance: async (op) => await custody.currentAllowance(op),
    releaseNonce: async (op, kind, nonce) => await custody.releaseNonce(op, kind, nonce), commitNonce: async (op, kind, nonce) => await custody.commitNonce(op, kind, nonce),
    guard: async () => { if (chain.guard !== null) throw chain.guard; },
    reserveUsage: async () => { throw new Error("no reservation"); },
    currentUsage: async (op) => ({ reservationId: op.usageReservationId!, state: op.usageState! }),
    followUsage: async (op, target) => ({ reservationId: op.usageReservationId!, state: target }),
    seal: async (op, kind, nonce) => { counts.seal += 1; const envelope = envelopeOf(op, kind, nonce), hash = keccak256(`0x${Buffer.from(JSON.stringify(envelope)).toString("hex")}`);
      await effects.seal(op, kind, hash, envelope, new Date()); return { transactionHash: hash, envelopeHash: "e".repeat(64) }; },
    probeSealed: async (op, kind, nonce) => await custody.probeSealed(op, kind, nonce),
    recoverSealed: async (op, kind, nonce) => await custody.probeJournaled(op, kind, nonce),
    send: async (_op, kind) => { counts.sends.push(kind); return "accepted"; },
    observe: async (_op, _kind, hash) => chain.observation === null ? null : { ...chain.observation, transactionHash: hash } };
  return ports;
}

test("the captured fee-refused swaps clean up through the normal cleanup: same journal, the stranded cleanup nonce, one send", async (t) => {
  for (const record of LIVE.operations) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const { state, journal, op } = await seedLive(temporary.root, record), live = LIVE.chain[op.operationId]!;
    const nonce = live.reservations.find((row) => row.kind === "cleanup")!.nonce, approval = live.reservations.find((row) => row.kind === "approval")!.nonce;
    assert.equal(op.integrityHash, record.integrityHash); assert.equal(op.preSignFailure?.reason, "uniswap_token_fee_cap");
    assert.deepEqual(reservations(temporary.root, op.account), [`approval:${approval}:committed`, `cleanup:${nonce}:reserved`]);
    const chain = { allowance: live.allowanceAtomic, pending: live.pendingNonce, guard: null as unknown, observation: null as TokenEffectObservation | null };
    const counts = { consent: 0, seal: 0, sends: [] as TokenEffectKind[] }, reopen = () => new UniswapTokenExecution(new UniswapTokenJournal(temporary.root), livePorts(temporary.root, state, chain, counts));

    let current = await reopen().cleanup(op.operationId);
    assert.equal(current.phase, "cleanup_submitted"); assert.equal(current.operationId, op.operationId);
    assert.equal(current.cleanupAttempt?.nonce, nonce, "the cleanup signs with the nonce its failed attempt reserved");
    assert.deepEqual(current.preSignFailure, op.preSignFailure, "the swap's pre-sign diagnostic stays as history");
    assert.deepEqual([current.approvalAttempt, current.swapAttempt, current.usageState], [op.approvalAttempt, op.swapAttempt, "reserved"]);
    assert.deepEqual(reservations(temporary.root, op.account), [`approval:${approval}:committed`, `cleanup:${nonce}:committed`]);
    assert.deepEqual([counts.consent, counts.seal, counts.sends], [1, 1, ["cleanup"]]);
    const chainOfRecords = await journal.load(op.operationId); assert.equal(chainOfRecords?.integrityHash, current.integrityHash);

    // Reopen: status observes the same cleanup; nothing is signed or sent again.
    current = await reopen().status(op.operationId); assert.equal(current.phase, "cleanup_submitted");
    chain.observation = { status: "success", transactionHash: H("0"), gasDebitWei: "21000", allowanceAtomic: "0" }; chain.allowance = "0";
    current = await reopen().status(op.operationId);
    assert.equal(current.phase, "cleaned"); assert.equal(current.accumulatedNativeDebitWei, (BigInt(op.accumulatedNativeDebitWei) + 21000n).toString());
    assert.equal(current.usageState, "reserved", "without a finalized-chain proof that the swap's nonce is spent, the principal stays charged");
    current = await reopen().cleanup(op.operationId); assert.equal(current.phase, "cleaned");
    assert.deepEqual([counts.consent, counts.seal, counts.sends], [1, 1, ["cleanup"]]);
  }
});

test("a cleanup refused before signing (fee cap) frees its nonce and stays retryable; the next consent sends once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const record = LIVE.operations[0]!;
  const { state, op } = await seedLive(temporary.root, record), live = LIVE.chain[op.operationId]!;
  const chain = { allowance: live.allowanceAtomic, pending: live.pendingNonce, guard: FEE_CAP as unknown, observation: null as TokenEffectObservation | null };
  const counts = { consent: 0, seal: 0, sends: [] as TokenEffectKind[] }, reopen = () => new UniswapTokenExecution(new UniswapTokenJournal(temporary.root), livePorts(temporary.root, state, chain, counts));
  let current = await reopen().cleanup(op.operationId);
  assert.deepEqual([current.phase, current.cleanupReason, current.cleanupAttempt], ["cleanup_required", "cleanup_pre_sign_failed", null]);
  assert.deepEqual(current.preSignFailure, { code: "APN_OPERATION_BLOCKED", reason: "uniswap_token_fee_cap", rpcMethod: null, endpointRole: null, phase: "cleanup_submission_started" });
  assert.deepEqual(reservations(temporary.root, op.account), ["approval:7:committed"], "no reservation is stranded");
  assert.deepEqual([counts.seal, counts.sends], [0, []]);
  chain.guard = null; current = await reopen().cleanup(op.operationId);
  assert.deepEqual([current.phase, current.cleanupAttempt?.nonce], ["cleanup_submitted", "8"]);
  assert.deepEqual([counts.consent, counts.seal, counts.sends], [2, 1, ["cleanup"]]);
});

class RefuseMarkerOnce extends UniswapTokenJournal {
  refused = false;
  override async save(value: UniswapTokenOperation): Promise<UniswapTokenOperation> {
    if (!this.refused && value.phase === "cleanup_submission_started") { this.refused = true; throw new ApnError("APN_STATE_CORRUPT", "injected marker refusal"); }
    return await super.save(value);
  }
}
test("a cleanup marker the journal refuses never strands the nonce it just reserved", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const record = LIVE.operations[0]!;
  const { state, op } = await seedLive(temporary.root, record), live = LIVE.chain[op.operationId]!;
  const chain = { allowance: live.allowanceAtomic, pending: live.pendingNonce, guard: null as unknown, observation: null as TokenEffectObservation | null };
  const counts = { consent: 0, seal: 0, sends: [] as TokenEffectKind[] }, refusing = new RefuseMarkerOnce(temporary.root);
  await assert.rejects(new UniswapTokenExecution(refusing, livePorts(temporary.root, state, chain, counts)).cleanup(op.operationId), /injected marker refusal/u);
  assert.equal((await new UniswapTokenJournal(temporary.root).load(op.operationId))?.integrityHash, op.integrityHash);
  assert.deepEqual(reservations(temporary.root, op.account), ["approval:7:committed"]);
  assert.deepEqual([counts.seal, counts.sends], [0, []]);
  const current = await new UniswapTokenExecution(refusing, livePorts(temporary.root, state, chain, counts)).cleanup(op.operationId);
  assert.deepEqual([current.phase, current.cleanupAttempt?.nonce, counts.sends], ["cleanup_submitted", "8", ["cleanup"]]);
});

/** The production runtime (custody, encrypted wallet, nonce store, ledger, observer) over a fake Ethereum node. */
async function production(root: string) {
  const now = new Date(), key = `0x${"0".repeat(63)}2` as Hex, account = privateKeyToAccount(key).address;
  const policy = await activateDirectPolicy(root, "token-swap", { accounts: { evm: account }, now, admissions: [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({
    chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "3000000", mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
  const state = new StateStore(root); await state.initialize(); await new EncryptedWalletStore(state, WRAPPING).importNew("token-swap", key, account);
  const usage = new UniswapTokenUsage(state, { now: () => now }, new AssetUsageLedger(root));
  const node = { allowance: "500000", pending: 8n, baseFee: 0n, tx: null as unknown, receipt: null as unknown, sends: [] as Hex[] };
  const block = () => ({ number: "0x64", hash: H("b"), baseFeePerGas: `0x${node.baseFee.toString(16)}` });
  const call = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_chainId") return "0x1"; if (method === "eth_getTransactionCount") return `0x${node.pending.toString(16)}`;
    if (method === "eth_getBlockByNumber") return block(); if (method === "eth_getBalance") return "0xffffffffffffffff";
    if (method === "eth_call") { const data = String((params[0] as { data?: string }).data);
      return data.startsWith("0xdd62ed3e") ? word(BigInt(node.allowance)) : data.startsWith("0x70a08231") ? word(10_000_000n) : word(1n); }
    if (method === "eth_estimateGas") return "0x5208"; if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_sendRawTransaction") { const raw = params[0] as Hex; node.sends.push(raw); return keccak256(raw); }
    if (method === "eth_getTransactionByHash") return node.tx; if (method === "eth_getTransactionReceipt") return node.receipt;
    throw new Error(method);
  };
  let phrase = ""; const screens: string[] = [];
  const tty = { isTerminal: () => true, openTerminal: async () => ({ fd: 1, write: async (screen: string) => { screens.push(screen); phrase = /Type ([a-z0-9-]+) and/u.exec(screen)?.[1] ?? ""; },
    read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => undefined }) };
  const runtime = () => createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock: { now: () => now }, call, foreground: "cleanup", tty, verifyPins: async () => undefined });
  return { now, account, policy, state, usage, node, runtime, screens };
}
/** The captured record's shape (gas envelopes, fee-cap diagnostic at submission_started, approval nonce 7, hashless swap nonce 8) for a test signer. */
async function liveShaped(root: string, p: Awaited<ReturnType<typeof production>>) {
  const captured = LIVE.operations[0]!, journal = new UniswapTokenJournal(root), at = p.now;
  const prepared = await journal.save(newUniswapTokenOperation({ operationId: captured.operationId, profile: "token-swap", account: p.account,
    route: createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: p.account, amountIn: captured.route.amountIn,
      amountOutMinimum: captured.route.amountOutMinimum, deadline: Math.floor(at.getTime() / 1000) + 3_600 }), approvalCapAtomic: captured.approvalCapAtomic,
    allowanceAtPrepare: "0", approvalGas: captured.approvalGas, swapGas: captured.swapGas, cleanupGas: captured.cleanupGas,
    maximumNativeDebitWei: captured.maximumNativeDebitWei, policyDigest: p.policy.policyDigest, mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN),
    quoteBlock: captured.quoteBlock!, now: at }));
  const usage = await p.usage.reserve(prepared);
  let op = await journal.save(transitionUniswapToken(prepared, "approved", { usageReservationId: usage.reservationId, usageState: usage.state }, at));
  const approval = tokenAttempt(op, "approval", "7", at);
  op = await journal.save(transitionUniswapToken(op, "approval_submission_started", { approvalAttempt: approval }, at));
  op = await journal.save(transitionUniswapToken(op, "approval_submitted", { approvalAttempt: { ...approval, transactionHash: captured.approvalAttempt!.transactionHash } }, at));
  op = await journal.save(transitionUniswapToken(op, "approval_observed", { accumulatedNativeDebitWei: captured.accumulatedNativeDebitWei }, at));
  op = await journal.save(transitionUniswapToken(op, "submission_started", { swapAttempt: tokenAttempt(op, "swap", "8", at) }, at));
  op = await journal.save(transitionUniswapToken(op, "cleanup_required", { cleanupReason: captured.cleanupReason, preSignFailure: captured.preSignFailure! }, at));
  const nonces = new UniswapTokenNonceStore(root); await nonces.allocate(op, "approval", 7n); await nonces.commit(op, "approval", "7");
  assert.equal(await nonces.allocate(op, "cleanup", 8n), "8");
  return op;
}
function landed(p: Awaited<ReturnType<typeof production>>, op: UniswapTokenOperation) {
  const attempt = op.cleanupAttempt!, envelope = envelopeOf(op, "cleanup", attempt.nonce), hex = (v: string) => `0x${BigInt(v).toString(16)}`;
  p.node.tx = { hash: attempt.transactionHash, chainId: "0x1", from: op.account, to: envelope.to, input: envelope.data, value: "0x0", nonce: hex(envelope.nonce),
    gas: hex(envelope.gasLimit), maxFeePerGas: hex(envelope.maxFeePerGas), maxPriorityFeePerGas: hex(envelope.maxPriorityFeePerGas), type: "0x2", blockNumber: "0x64", blockHash: H("b") };
  p.node.receipt = { transactionHash: attempt.transactionHash, from: op.account, to: envelope.to, blockNumber: "0x64", blockHash: H("b"), status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x1" };
  p.node.allowance = "0";
}

test("production cleanup of a live-shaped fee-refused swap: fee refusal frees the nonce, then one signed nonce-8 revoke closes it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const p = await production(temporary.root), op = await liveShaped(temporary.root, p);
  p.node.baseFee = 150_000_000n;
  let current = await p.runtime().cleanup(op.operationId);
  assert.deepEqual([current.phase, current.cleanupReason, current.preSignFailure?.reason, current.cleanupAttempt], ["cleanup_required", "cleanup_pre_sign_failed", "uniswap_token_fee_cap", null]);
  assert.deepEqual(reservations(temporary.root, p.account), ["approval:7:committed"]); assert.equal(p.node.sends.length, 0);
  p.node.baseFee = 1n; current = await p.runtime().cleanup(op.operationId);
  assert.equal(current.phase, "cleanup_submitted"); assert.equal(p.node.sends.length, 1);
  const signed = parseTransaction(p.node.sends[0]!);
  assert.deepEqual([signed.nonce, signed.to?.toLowerCase(), signed.data], [8, UNISWAP_USDC.toLowerCase(), envelopeOf(current, "cleanup", "8").data]);
  assert.deepEqual(reservations(temporary.root, p.account), ["approval:7:committed", "cleanup:8:committed"]);
  landed(p, current); current = await p.runtime().status(op.operationId);
  assert.deepEqual([current.phase, current.usageState, p.node.sends.length], ["cleaned", "reserved", 1]);
  current = await p.runtime().cleanup(op.operationId); assert.deepEqual([current.phase, p.node.sends.length], ["cleaned", 1]);
});

test("an approval refused before signing with zero allowance closes with no effect and releases its hold", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const p = await production(temporary.root), journal = new UniswapTokenJournal(temporary.root);
  const captured = LIVE.operations[0]!, prepared = await journal.save(newUniswapTokenOperation({ operationId: "c".repeat(64), profile: "token-swap", account: p.account,
    route: createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: p.account, amountIn: "500000", amountOutMinimum: "495000",
      deadline: Math.floor(p.now.getTime() / 1000) + 3_600 }), approvalCapAtomic: "500000", allowanceAtPrepare: "0", approvalGas: captured.approvalGas,
    swapGas: captured.swapGas, cleanupGas: captured.cleanupGas, maximumNativeDebitWei: captured.maximumNativeDebitWei, policyDigest: p.policy.policyDigest,
    mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), now: p.now }));
  const usage = await p.usage.reserve(prepared);
  const approved = await journal.save(transitionUniswapToken(prepared, "approved", { usageReservationId: usage.reservationId, usageState: usage.state }, p.now));
  p.node.allowance = "0"; p.node.pending = 7n; p.node.baseFee = 150_000_000n;
  let current = await p.runtime().execute(approved.operationId);
  assert.deepEqual([current.phase, current.cleanupReason, current.approvalAttempt, current.preSignFailure?.phase], ["cleanup_required", "approval_pre_sign_failed", null, "approval_submission_started"]);
  assert.equal(p.node.sends.length, 0);
  current = await p.runtime().cleanup(approved.operationId);
  assert.deepEqual([current.phase, current.cleanupReason, current.usageState, current.cleanupEvidence?.kind], ["cleaned", "zero_allowance_no_effect", "failed_before_effect", "zero_allowance_no_effect"]);
  assert.equal(current.preSignFailure?.reason, "uniswap_token_fee_cap"); assert.equal(p.node.sends.length, 0);
});

test("a cleanup the frozen fee cap refuses offers the owner's re-quote; the fresh quote checks the caps and the consent shows them", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const p = await production(temporary.root), op = await liveShaped(temporary.root, p);
  p.node.baseFee = 150_000_000n; // twice it plus the tip is above the 0.2 gwei cap frozen at swap time
  let current = await p.runtime().cleanup(op.operationId);
  assert.deepEqual([current.phase, current.preSignFailure?.reason, current.cleanupAttempt], ["cleanup_required", "uniswap_token_fee_cap", null]);
  const cleanup = `apn swap ethereum uniswap-token cleanup --operation ${op.operationId}`;
  assert.deepEqual(uniswapTokenNextActions(current), [cleanup, `${cleanup} --max-fee-per-gas <wei> --max-priority-fee-per-gas <wei>`]);
  const status = await executeUniswapCommand({ command: "swap.uniswap-token.status", operationId: op.operationId }, { uniswapTokenRuntime: p.runtime() } as never);
  assert.deepEqual(status.nextActions, uniswapTokenNextActions(current));

  // Caps below the fresh quote are refused before consent; the refusal names the quote. Nothing is saved or signed.
  const screens = p.screens.length;
  await assert.rejects(p.runtime().cleanup(op.operationId, { maxFeePerGas: "300000000", maxPriorityFeePerGas: "1000000" }), (error: ApnError) =>
    error.details?.reason === "uniswap_token_cleanup_fee_quote" && error.details?.minimumMaxFeePerGasWei === "300000001" && error.details?.baseFeePerGasWei === "150000000");
  assert.equal(p.screens.length, screens); assert.equal((await new UniswapTokenJournal(temporary.root).load(op.operationId))?.integrityHash, current.integrityHash);

  current = await p.runtime().cleanup(op.operationId, { maxFeePerGas: "1000000000", maxPriorityFeePerGas: "1000000" });
  assert.equal(current.phase, "cleanup_submitted"); assert.equal(p.node.sends.length, 1);
  const shown = p.screens.at(-1)!;
  for (const line of ["base fee 150000000 wei", "Cleanup max fee per gas: 1000000000 wei (frozen: 200000000)", "Native debit cap: 130000000000000 wei (was 100000000000000)"])
    assert.ok(shown.includes(line), line);
  const signed = parseTransaction(p.node.sends[0]!);
  assert.deepEqual([signed.nonce, signed.maxFeePerGas, signed.maxPriorityFeePerGas, signed.gas], [8, 1_000_000_000n, 1_000_000n, 70_000n]);
  assert.deepEqual([current.cleanupGas.maxFeePerGas, current.maximumNativeDebitWei, current.swapGas.maxFeePerGas], ["1000000000", "130000000000000", "200000000"]);
  assert.deepEqual([current.cleanupFeeQuote?.previousCleanupGas.maxFeePerGas, current.cleanupFeeQuote?.baseFeePerGasWei], ["200000000", "150000000"]);
  landed(p, current); current = await p.runtime().status(op.operationId);
  assert.deepEqual([current.phase, p.node.sends.length], ["cleaned", 1]);
  assert.equal((await p.runtime().cleanup(op.operationId, { maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1000000" })).phase, "cleaned");
  assert.equal(p.node.sends.length, 1);
});

test("a re-quote never replaces the caps of a cleanup slot that holds a marker", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const p = await production(temporary.root), journal = new UniswapTokenJournal(temporary.root);
  let op = await liveShaped(temporary.root, p);
  op = await journal.save(transitionUniswapToken(op, "cleanup_submission_started", { cleanupAttempt: tokenAttempt(op, "cleanup", "8", p.now) }, p.now));
  op = await journal.save(transitionUniswapToken(op, "cleanup_required", { cleanupReason: "cleanup_pre_sign_failed" }, p.now));
  assert.throws(() => requotedCleanup(op, { maxFeePerGas: "1000000000", maxPriorityFeePerGas: "1" },
    { blockNumber: "100", blockHash: H("b"), baseFeePerGasWei: "1", priorityFeePerGasWei: "1" }, p.now), (error: ApnError) => error.details?.reason === "uniswap_token_cleanup_requote_slot");
});

test("the cleanup command binds the owner's re-quote caps only as a complete, ordered pair", () => {
  const base = ["swap", "ethereum", "uniswap-token", "cleanup", "--operation", "a".repeat(64)];
  assert.deepEqual(bindArgv(base).request, { command: "swap.uniswap-token.cleanup", operationId: "a".repeat(64) });
  assert.deepEqual(bindArgv([...base, "--max-fee-per-gas", "1000000000", "--max-priority-fee-per-gas", "1000000"]).request,
    { command: "swap.uniswap-token.cleanup", operationId: "a".repeat(64), cleanupFees: { maxFeePerGas: "1000000000", maxPriorityFeePerGas: "1000000" } });
  for (const extra of [["--max-fee-per-gas", "1000000000"], ["--max-priority-fee-per-gas", "1"], ["--max-fee-per-gas", "1", "--max-priority-fee-per-gas", "2"],
    ["--max-fee-per-gas", "0", "--max-priority-fee-per-gas", "0"], ["--max-fee-per-gas", "01", "--max-priority-fee-per-gas", "0"]])
    assert.throws(() => bindArgv([...base, ...extra]), { code: "APN_INVALID_INPUT" }, extra.join(" "));
});
