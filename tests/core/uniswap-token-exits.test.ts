import assert from "node:assert/strict";
import test from "node:test";
import type { AssetUsageState } from "../../src/asset-usage-ledger.js";
import { domainHash } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import { checkNeverLands } from "../../src/evm-finalized-proof.js";
import type { OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { namedProfileHash } from "../../src/operation-index/adapters/family-claims.js";
import { OperationService } from "../../src/operation-service.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { UniswapTokenExecution, type TokenEffectKind, type TokenEffectObservation, type UniswapTokenCommandRuntime } from "../../src/swap/uniswap-v3/token-execution.js";
import { newUniswapTokenOperation, tokenAttempt, tokenEffectRound, transitionUniswapToken, UniswapTokenJournal, type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { temporaryState } from "./helpers.js";
import { ERA, finalizedNode } from "./finalized-node.js";

/**
 * R4 exits of a Uniswap token swap, through the CLI: a bound approval, swap or cleanup the node no longer knows, once
 * the finalized nonce passed it, can never land (exit 2); a cleanup that never landed or landed without zeroing the
 * allowance is re-armed for a fresh, consented cleanup in a new nonce/custody round; the owner's abandon (exit 3) is
 * the last resort past the route deadline. Nothing is re-signed while a signed effect could still land.
 */
const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", RECIPIENT = "0x2222222222222222222222222222222222222222", PROFILE = "token-swap";
const H = (c: string) => `0x${c.repeat(64)}`, NOW = new Date("2026-09-22T00:00:00.000Z"), DEADLINE = 1_900_000_000, ID = "a".repeat(64);
const wrapping = { load: async () => Buffer.alloc(32), create: async () => Buffer.alloc(32) } as never;
/** Approval, swap and cleanup hashes; a re-armed cleanup round signs a different transaction. */
const hashOf = (op: UniswapTokenOperation, kind: TokenEffectKind) => kind === "approval" ? H("1") : kind === "swap" ? H("2") : H(String(3 + tokenEffectRound(op, kind)));

async function fixture(root: string, allowanceAtPrepare = "0") {
  const route = createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: RECIPIENT, amountIn: "1000000",
    amountOutMinimum: "990000", deadline: DEADLINE }), gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  const journal = new UniswapTokenJournal(root);
  await journal.save(newUniswapTokenOperation({ operationId: ID, profile: PROFILE, account: ACCOUNT, route, approvalCapAtomic: "1000000",
    allowanceAtPrepare, approvalGas: gas, swapGas: gas, cleanupGas: gas, maximumNativeDebitWei: "600000", policyDigest: domainHash("p", "p"),
    mechanismDigest: domainHash("m", "m"), quoteBlock: { number: ERA.number.toString(), hash: ERA.hash }, now: NOW }));
  const sends: string[] = [], consents: string[] = [], observations = new Map<string, TokenEffectObservation>();
  let allowance = allowanceAtPrepare, now = NOW, usage: AssetUsageState = "reserved", nonce = 7, finalizedNonce = 0n;
  const ports = { now: () => now, foregroundApprove: async () => { consents.push("approve"); }, foregroundCleanup: async (op: UniswapTokenOperation) => { consents.push(`cleanup:${op.integrityHash}`); },
    withAccountLock: async <T>(_op: unknown, work: () => Promise<T>) => await work(), allocateNonce: async () => String(nonce++),
    releaseNonce: async () => true, commitNonce: async () => {}, currentAllowance: async () => allowance, guard: async () => {}, revalidate: async () => {},
    reserveUsage: async () => { usage = "reserved"; return { reservationId: "d".repeat(64), state: usage }; },
    currentUsage: async () => ({ reservationId: "d".repeat(64), state: usage }),
    followUsage: async (_op: unknown, target: AssetUsageState) => { usage = target; return { reservationId: "d".repeat(64), state: usage }; },
    seal: async (op: UniswapTokenOperation, kind: TokenEffectKind) => ({ transactionHash: hashOf(op, kind), envelopeHash: "e".repeat(64) }),
    probeSealed: async () => null, send: async (op: UniswapTokenOperation, kind: TokenEffectKind) => { sends.push(`${kind}:${hashOf(op, kind)}`); return "ambiguous" as const; },
    observe: async (_op: unknown, _kind: TokenEffectKind, hash: string) => observations.get(hash) ?? null,
    // The real R4 check against a finalized-tag node indexing the quote block: unknown hashes are not found.
    neverLands: async (op: UniswapTokenOperation, _kind: TokenEffectKind, attempt: { nonce: string; transactionHash: string | null }) =>
      await checkNeverLands({ chainId: 1, account: op.account, nonce: BigInt(attempt.nonce), transactionHash: attempt.transactionHash!,
        before: { hash: op.quoteBlock!.hash, number: BigInt(op.quoteBlock!.number) } }, finalizedNode(1, () => finalizedNonce).batch) };
  // One execution per command, as each CLI process builds its own runtime.
  const execution = () => new UniswapTokenExecution(journal, ports);
  const runtime: UniswapTokenCommandRuntime = { inventory: () => ({}), quote: async () => ({}), prepare: async () => { throw new Error("unused"); },
    approve: async id => await execution().approve(id), execute: async id => await execution().execute(id), status: async id => await execution().status(id),
    cleanup: async id => await execution().cleanup(id) };
  const cli = async (argv: readonly string[], approve?: (intent: OperationAbandonIntent) => Promise<void>) =>
    await createApnCore(bindArgv([...argv]), { stateRoot: root, wrappingSecret: wrapping, clock: { now: () => now }, uniswapTokenRuntime: runtime,
      ...(approve === undefined ? {} : { operationAbandonApproval: { approve } }) }).execute(bindArgv([...argv]).request);
  const op = async () => (await journal.load(ID))!;
  return { cli, op, sends, consents, observations, usage: () => usage, allowance: (value: string) => { allowance = value; },
    finalized: (value: bigint) => { finalizedNonce = value; }, now: (value: Date) => { now = value; } };
}
const status = ["operation", "status", "--operation", ID], cleanup = ["swap", "ethereum", "uniswap-token", "cleanup", "--operation", ID];
const held = async (root: string) => await new OperationService(new StateStore(root)).assertEvmAccountAvailable(namedProfileHash(PROFILE), 1, ACCOUNT)
  .then(() => false, (error: { code?: string }) => error.code === "APN_OPERATION_BLOCKED");

test("a dropped swap stays open while its nonce is not finalized past, then never lands: hold released, cleanup by consent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root, "1000000");
  assert.equal((await f.cli(["swap", "ethereum", "uniswap-token", "approve", "--operation", ID])).ok, true);
  const sent = await f.cli(["swap", "ethereum", "uniswap-token", "execute", "--operation", ID]);
  assert.equal((sent.operation as UniswapTokenOperation).phase, "unknown_finality");
  const nonce = BigInt((await f.op()).swapAttempt!.nonce);
  f.finalized(nonce);
  const open = await f.cli(status);
  assert.deepEqual([(open.operation as UniswapTokenOperation).phase, f.usage(), await held(temporary.root)], ["unknown_finality", "unknown_finality", true]);
  f.finalized(nonce + 1n);
  const retired = (await f.cli(status)).operation as UniswapTokenOperation;
  assert.deepEqual([retired.phase, retired.cleanupReason, retired.swapAttempt, retired.usageState, f.usage()],
    ["cleanup_required", "swap_never_landed", null, "released_unsubmitted", "released_unsubmitted"]);
  assert.deepEqual(retired.retiredEffects?.map(row => [row.kind, row.reason, row.attempt.transactionHash, row.finalizedNonceAtomic]),
    [["swap", "never_landed", H("2"), (nonce + 1n).toString()]]);
  assert.deepEqual(f.sends, [`swap:${H("2")}`], "nothing re-signed or re-sent by the exit");
  assert.equal(await held(temporary.root), true, "the residual allowance keeps the account until its cleanup");
  const cleaning = (await f.cli(cleanup)).operation as UniswapTokenOperation;
  assert.deepEqual([cleaning.phase, f.sends.at(-1), f.consents.length], ["cleanup_unknown_finality", `cleanup:${H("3")}`, 2]);
});

test("a reverted cleanup and a dropped one are re-armed for a fresh consented cleanup in a new round; then it cleans", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root, "1000000");
  await f.cli(["swap", "ethereum", "uniswap-token", "approve", "--operation", ID]); await f.cli(["swap", "ethereum", "uniswap-token", "execute", "--operation", ID]);
  f.observations.set(H("2"), { status: "reverted", transactionHash: H("2"), gasDebitWei: "100", allowanceAtomic: "1000000" });
  assert.equal(((await f.cli(status)).operation as UniswapTokenOperation).phase, "cleanup_required");
  await f.cli(cleanup);
  f.observations.set(H("3"), { status: "reverted", transactionHash: H("3"), gasDebitWei: "450000", allowanceAtomic: "1000000" });
  const rearmed = (await f.cli(status)).operation as UniswapTokenOperation;
  assert.deepEqual([rearmed.phase, rearmed.cleanupReason, rearmed.cleanupAttempt, rearmed.accumulatedNativeDebitWei, rearmed.maximumNativeDebitWei],
    ["cleanup_required", "cleanup_reverted", null, "450100", "650100"], "the landed cleanup's gas counts and the cap grows by one more cleanup");
  // Status alone never signs: a re-armed cleanup waits for the owner's fresh consent.
  assert.equal(((await f.cli(status)).operation as UniswapTokenOperation).phase, "cleanup_required");
  assert.deepEqual(f.sends, [`swap:${H("2")}`, `cleanup:${H("3")}`]);
  const second = (await f.cli(cleanup)).operation as UniswapTokenOperation;
  assert.deepEqual([second.phase, second.cleanupAttempt?.transactionHash, f.sends.at(-1)], ["cleanup_unknown_finality", H("4"), `cleanup:${H("4")}`]);
  assert.notEqual(f.consents[1], f.consents[2], "the second cleanup is consented on the re-armed record");
  // The second cleanup is dropped: open until its nonce is finalized past, then re-armed again.
  const nonce = BigInt(second.cleanupAttempt!.nonce);
  f.finalized(nonce);
  assert.equal(((await f.cli(status)).operation as UniswapTokenOperation).phase, "cleanup_unknown_finality");
  f.finalized(nonce + 1n);
  const dropped = (await f.cli(status)).operation as UniswapTokenOperation;
  assert.deepEqual([dropped.phase, dropped.cleanupReason, dropped.retiredEffects?.map(row => `${row.kind}:${row.reason}`)],
    ["cleanup_required", "cleanup_never_landed", ["cleanup:reverted", "cleanup:never_landed"]]);
  const third = (await f.cli(cleanup)).operation as UniswapTokenOperation;
  assert.equal(third.cleanupAttempt?.transactionHash, H("5"));
  f.observations.set(H("5"), { status: "success", transactionHash: H("5"), gasDebitWei: "50", allowanceAtomic: "0" }); f.allowance("0");
  assert.equal(((await f.cli(status)).operation as UniswapTokenOperation).phase, "cleaned");
  assert.equal(await held(temporary.root), false);
});

test("a dropped approval with the allowance still zero ends with no effect; a zeroed allowance after effects needs no new cleanup", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root);
  const approving = (await f.cli(["swap", "ethereum", "uniswap-token", "approve", "--operation", ID])).operation as UniswapTokenOperation;
  assert.equal(approving.phase, "approval_unknown_finality");
  f.finalized(BigInt(approving.approvalAttempt!.nonce) + 1n);
  const ended = (await f.cli(status)).operation as UniswapTokenOperation;
  assert.deepEqual([ended.phase, ended.cleanupReason, ended.cleanupEvidence?.kind, ended.usageState, ended.approvalAttempt],
    ["cleaned", "zero_allowance_no_effect", "zero_allowance_no_effect", "failed_before_effect", null]);
  assert.equal(await held(temporary.root), false);

  const other = await temporaryState(); t.after(other.cleanup);
  const g = await fixture(other.root, "1000000");
  await g.cli(["swap", "ethereum", "uniswap-token", "approve", "--operation", ID]); await g.cli(["swap", "ethereum", "uniswap-token", "execute", "--operation", ID]);
  g.finalized(BigInt((await g.op()).swapAttempt!.nonce) + 1n);
  assert.equal(((await g.cli(status)).operation as UniswapTokenOperation).phase, "cleanup_required");
  g.allowance("0");
  const zeroed = (await g.cli(cleanup)).operation as UniswapTokenOperation;
  assert.deepEqual([zeroed.phase, zeroed.cleanupReason, zeroed.cleanupEvidence?.kind], ["cleaned", "zero_allowance_after_effect", "zero_allowance_after_effect"]);
  assert.deepEqual(g.sends, [`swap:${H("2")}`]);
});

test("owner abandon is the last resort: refused before the route deadline, then terminal with consent; the ledger stays charged", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root, "1000000");
  await f.cli(["swap", "ethereum", "uniswap-token", "approve", "--operation", ID]); await f.cli(["swap", "ethereum", "uniswap-token", "execute", "--operation", ID]);
  const intents: OperationAbandonIntent[] = [], approve = async (intent: OperationAbandonIntent) => { intents.push(intent); };
  const early = await f.cli(["operation", "abandon", "--operation", ID], approve);
  assert.deepEqual([early.error?.code, early.error?.details?.reason, intents.length], ["APN_OPERATION_BLOCKED", "uniswap_token_abandon_not_eligible", 0]);
  f.now(new Date(DEADLINE * 1000 + 1));
  const abandoned = await f.cli(["operation", "abandon", "--operation", ID], approve);
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error));
  assert.deepEqual([(abandoned.operation as UniswapTokenOperation).phase, f.usage(), intents.length], ["abandoned_unknown", "unknown_finality", 1]);
  assert.match(intents[0]!.outcomeNote, new RegExp(`UNKNOWN \\(phase unknown_finality\\)\\. Signed transaction\\(s\\) ${H("2")} may still land`, "u"));
  assert.equal(await held(temporary.root), false, "the index released the account");
  const again = await f.cli(["operation", "abandon", "--operation", ID], approve);
  assert.deepEqual([(again.operation as UniswapTokenOperation).phase, intents.length], ["abandoned_unknown", 1], "a replay asks nothing");
  assert.equal(((await f.cli(["swap", "ethereum", "uniswap-token", "execute", "--operation", ID])).operation as UniswapTokenOperation).phase, "abandoned_unknown");
  assert.deepEqual(f.sends, [`swap:${H("2")}`]);
});

test("the real ledger releases a never-landed swap's hold as unsubmitted from reserved, submitted or unknown finality", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const policy = await activateDirectPolicy(temporary.root, PROFILE, { accounts: { evm: ACCOUNT }, now: NOW, admissions: [UNISWAP_USDC, ETHEREUM_USDT]
    .map(identifier => ({ chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000",
      dailyLimitAtomic: "3000000", mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
  const ledger = new AssetUsageLedger(temporary.root), usage = new UniswapTokenUsage(new StateStore(temporary.root), { now: () => NOW }, ledger);
  const route = createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: RECIPIENT, amountIn: "1000000",
    amountOutMinimum: "990000", deadline: DEADLINE }), gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  const bound = async (id: string) => {
    const op = newUniswapTokenOperation({ operationId: id.repeat(64), profile: PROFILE, account: ACCOUNT, route, approvalCapAtomic: "1000000",
      allowanceAtPrepare: "1000000", approvalGas: gas, swapGas: gas, cleanupGas: gas, maximumNativeDebitWei: "600000",
      policyDigest: policy.policyDigest, mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), now: NOW });
    const lease = await usage.reserve(op);
    return transitionUniswapToken(op, "unknown_finality", { usageReservationId: lease.reservationId, usageState: lease.state,
      swapAttempt: { ...tokenAttempt(op, "swap", "7", NOW), transactionHash: H("2") } }, NOW);
  };
  const identity = { account: ACCOUNT, chain: "eip155:1", asset: { kind: "token" as const, identifier: UNISWAP_USDC } };
  const reserved = await bound("b"), submitted = await bound("c"), unknown = await bound("e");
  await usage.follow(submitted, "submitted"); await usage.follow(unknown, "unknown_finality");
  assert.equal((await ledger.usage(identity, NOW)).amountAtomic, "3000000");
  for (const op of [reserved, submitted, unknown]) assert.equal((await usage.follow(op, "released_unsubmitted")).state, "released_unsubmitted");
  assert.equal((await ledger.usage(identity, NOW)).amountAtomic, "0", "nothing of a swap that never landed counts");
  // Only a bound swap's hold can be released as unsubmitted.
  await assert.rejects(usage.follow({ ...await bound("f"), swapAttempt: null }, "released_unsubmitted"), { code: "APN_STATE_CORRUPT" });
});
