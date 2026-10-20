import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { privateKeyToAccount } from "viem/accounts";
import { parseTransaction, type Hex } from "viem";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageReservation } from "../../src/asset-usage-ledger.js";
import { idempotency, seal } from "../../src/asset-usage-ledger-record.js";
import { canonicalJson, domainHash, hashObject } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { envelopeOf } from "../../src/swap/uniswap-v3/token-custody.js";
import { UniswapTokenEffectJournal } from "../../src/swap/uniswap-v3/token-effects.js";
import { UniswapTokenNonceStore } from "../../src/swap/uniswap-v3/token-nonce.js";
import { tokenAttempt, transitionUniswapToken, UniswapTokenJournal, validateUniswapTokenOperation, type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { blockHash, CapturedState, movingNode, pinsLikeProduction, tokenSession, typingTerminal, usageBucket, WRAPPING } from "./uniswap-token-qa0552-harness.js";

interface Cleaned { readonly operation: UniswapTokenOperation; readonly usage: AssetUsageReservation; readonly cleanupTransaction: Record<string, string>;
  readonly finalizedHead: { readonly number: string; readonly hash: string }; readonly nonceAtFinality: number }
const LIVE = JSON.parse(readFileSync("tests/core/fixtures/uniswap-token-qa0552.json", "utf8")) as { stranded: { operation: UniswapTokenOperation }; cleaned: Cleaned[] };
const identity = (op: UniswapTokenOperation) => ({ account: op.account, chain: "eip155:1", asset: { kind: "token" as const, identifier: op.route.inputToken } });
const usageKey = (op: UniswapTokenOperation) => `apn.uniswap-token-usage:${op.operationId}`;
const dayOf = (op: UniswapTokenOperation) => new Date(`${op.updatedAt.slice(0, 10)}T12:00:00.000Z`);
const command = (action: string, op: UniswapTokenOperation) => ["swap", "ethereum", "uniswap-token", action, "--operation", op.operationId];

/** The captured journal written as it is on the QA machine, its ledger row, and the node it is read through. */
async function captured(root: string, op: UniswapTokenOperation, usage: AssetUsageReservation, now: Date) {
  const state = new StateStore(root); await state.initialize(); await new UniswapTokenJournal(root).save(op);
  assert.equal(assetUsageReservationId(identity(op), usageKey(op)), op.usageReservationId); assert.equal(idempotency(usageKey(op)), usage.idempotencyHash);
  await new CapturedState(root).put(usageBucket(op.account, op.route.inputToken), `${usage.reservationId}.json`, usage);
  const chain = movingNode({ account: op.account, allowance: "0", pending: 0n }), ledger = new AssetUsageLedger(root);
  const cli = async (action: string, cap: number, tty?: ReturnType<typeof typingTerminal>["tty"]) => {
    const runtime = createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock: { now: () => now }, call: tokenSession(state, chain, cap),
      foreground: tty === undefined ? "refuse" : "cleanup", ...(tty === undefined ? {} : { tty }), verifyPins: pinsLikeProduction });
    return await createApnCore(bindArgv(command(action, op)), { stateRoot: root, wrappingSecret: WRAPPING, clock: { now: () => now }, uniswapTokenRuntime: runtime })
      .execute(bindArgv(command(action, op)).request);
  };
  return { state, chain, ledger, cli, used: async () => (await ledger.usage(identity(op), dayOf(op))).amountAtomic, row: async () => (await ledger.load(identity(op), usage.reservationId))!.state };
}
function nonceRows(root: string, account: string): string[] {
  const raw = JSON.parse(readFileSync(`${root}/uniswap-token-nonces/${domainHash("apn.uniswap-token-nonce-account.v1", account)}.json`, "utf8"));
  return Object.values(raw.reservations as Record<string, { kind: string; nonce: string; state: string }>).map((row) => `${row.kind}:${row.nonce}:${row.state}`).sort();
}

test("QA 0.5.52 live 867244e9…: status names execute; execute proves the stranded swap unsigned and, the 1 USDC approval standing, requires cleanup", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const op = validateUniswapTokenOperation(LIVE.stranded.operation);
  const now = new Date((op.route.deadline + 3_600) * 1000), usage = seal({ schemaVersion: "apn.asset-usage-reservation.v1", ...identity(op),
    reservationId: op.usageReservationId!, idempotencyHash: idempotency(usageKey(op)), policyDigest: op.policyDigest, registryVersion: "qa.052.central.captured",
    rail: "swap", amountAtomic: op.route.amountIn, reservedAt: op.approvalAttempt!.markedAt, updatedAt: op.approvalAttempt!.markedAt, state: "reserved", effectAt: null, outcomeDigest: null });
  const c = await captured(temporary.root, op, usage, now), nonces = new UniswapTokenNonceStore(temporary.root), effects = new UniswapTokenEffectJournal(temporary.root);
  await nonces.allocate(op, "approval", 9n); await nonces.commit(op, "approval", "9"); assert.equal(await nonces.allocate(op, "swap", 10n), "10");
  const approval = op.approvalAttempt!, envelope = envelopeOf(op, "approval", approval.nonce), hex = (v: string) => `0x${BigInt(v).toString(16)}`, block = 26_232_480n;
  await effects.seal(op, "approval", approval.transactionHash as Hex, envelope, new Date(approval.markedAt));
  await effects.markStarted(op, "approval", new Date(approval.markedAt)); await effects.markOutcome(op, "approval", "send_accepted", new Date(approval.markedAt));
  c.chain.node.txs.set(approval.transactionHash!, { hash: approval.transactionHash, chainId: "0x1", from: op.account, to: envelope.to, input: envelope.data, value: "0x0",
    nonce: hex(envelope.nonce), gas: hex(envelope.gasLimit), maxFeePerGas: hex(envelope.maxFeePerGas), maxPriorityFeePerGas: hex(envelope.maxPriorityFeePerGas), type: "0x2",
    blockNumber: hex(block.toString()), blockHash: blockHash(block) });
  c.chain.node.receipts.set(approval.transactionHash!, { transactionHash: approval.transactionHash, from: op.account, to: envelope.to, blockNumber: hex(block.toString()),
    blockHash: blockHash(block), status: "0x1", gasUsed: "0x8356", effectiveGasPrice: "0x23024ba" });
  c.chain.node.head = block + 400n; c.chain.node.pending = 10n; c.chain.node.allowance = op.route.amountIn;

  const refused = await c.cli("status", 11);
  assert.deepEqual([refused.ok, refused.error?.details?.reason, refused.next_actions], [false, "uniswap_token_public_effect_missing",
    [`apn swap ethereum uniswap-token execute --operation ${op.operationId}`]]);
  const server = createMcpServer({ stateRoot: temporary.root, clock: { now: () => now }, uniswapTokenRuntime: createUniswapTokenRuntime({ state: c.state, wrapping: WRAPPING,
    clock: { now: () => now }, call: tokenSession(c.state, c.chain, 11), foreground: "refuse", verifyPins: pinsLikeProduction }) });
  const pair = InMemoryTransport.createLinkedPair(); await server.connect(pair[1]); const client = new Client({ name: "qa0552", version: "1" }); await client.connect(pair[0]);
  t.after(async () => { await client.close(); await server.close(); });
  const content = (await client.callTool({ name: "apn_swap_ethereum_uniswap_token_status", arguments: { operation: op.operationId } })).content[0];
  const mcp = JSON.parse(content?.type === "text" ? content.text : "{}") as OutputEnvelope;
  assert.deepEqual([mcp.error?.details?.reason, mcp.next_actions], [refused.error?.details?.reason, refused.next_actions], "CLI and MCP name the same exit");
  assert.equal((await new UniswapTokenJournal(temporary.root).load(op.operationId))?.integrityHash, op.integrityHash);

  const executed = await c.cli("execute", 15), closed = executed.operation as UniswapTokenOperation, cleanup = `apn swap ethereum uniswap-token cleanup --operation ${op.operationId}`;
  assert.equal(executed.ok, true, JSON.stringify(executed.error));
  assert.deepEqual([closed.operationId, closed.phase, closed.cleanupReason, closed.cleanupEvidence, closed.usageState, closed.swapAttempt, executed.next_actions],
    [op.operationId, "cleanup_required", "deadline_expired_after_approval", null, "reserved", null, [cleanup]]);
  assert.deepEqual([closed.approvalAttempt, closed.accumulatedNativeDebitWei, closed.usageReservationId], [op.approvalAttempt, op.accumulatedNativeDebitWei, op.usageReservationId]);
  assert.deepEqual(c.chain.node.sends, [], "nothing is signed or sent"); assert.deepEqual(nonceRows(temporary.root, op.account), ["approval:9:committed"]);
  assert.deepEqual([await c.row(), await c.used()], ["reserved", op.route.amountIn], "the hold is released with the cleaned that follows the owner's revoke");
  const journal = new UniswapTokenJournal(temporary.root); assert.equal((await journal.load(op.operationId))?.integrityHash, closed.integrityHash);
  const again = await c.cli("status", 11);
  assert.deepEqual([(again.operation as UniswapTokenOperation).integrityHash, again.next_actions], [closed.integrityHash, [cleanup]]);
  assert.equal(((await c.cli("execute", 15)).operation as UniswapTokenOperation).integrityHash, closed.integrityHash);
});

test("867244e9…-shaped: a residual allowance takes one consented revoke at the freed nonce before cleaned; a zero one closes at once", async (t) => {
  for (const residual of [true, false]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup); const key = `0x${"0".repeat(63)}7` as Hex, account = privateKeyToAccount(key).address;
    const state = new StateStore(temporary.root); await state.initialize(); await new EncryptedWalletStore(state, WRAPPING).importNew("qa0552-shaped", key, account);
    let now = new Date(); await activateDirectPolicy(temporary.root, "qa0552-shaped", { accounts: { evm: account }, now, admissions: [UNISWAP_USDC, ETHEREUM_USDT]
      .map((identifier) => ({ chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000",
        dailyLimitAtomic: "1000000", mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
    const live = LIVE.stranded.operation, chain = movingNode({ account, allowance: "0", pending: 9n }), terminal = typingTerminal(), ledger = new AssetUsageLedger(temporary.root);
    const run = (cap: number, foreground: "approve" | "cleanup" | "refuse" = "refuse") => createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock: { now: () => now },
      call: tokenSession(state, chain, cap), foreground, tty: terminal.tty, verifyPins: pinsLikeProduction });
    const used = async () => (await ledger.usage({ account, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, now)).amountAtomic;
    const quote = await run(8).quote({ command: "swap.uniswap-token.quote", profile: "qa0552-shaped", account, recipient: account, sourceToken: UNISWAP_USDC,
      outputToken: ETHEREUM_USDT, amountAtomic: live.route.amountIn, minimumOutputAtomic: live.route.amountOutMinimum, approvalCapAtomic: live.approvalCapAtomic,
      deadline: Math.floor(now.getTime() / 1000) + 600, maxApprovalGasLimit: live.approvalGas.gasLimit, maxSwapGasLimit: live.swapGas.gasLimit,
      maxCleanupGasLimit: live.cleanupGas.gasLimit, maxFeePerGas: live.swapGas.maxFeePerGas, maxPriorityFeePerGas: live.swapGas.maxPriorityFeePerGas,
      maxNativeDebitWei: live.maximumNativeDebitWei }) as { quoteHash: string };
    let op = await run(9).prepare({ command: "swap.uniswap-token.prepare", profile: "qa0552-shaped", quoteHash: quote.quoteHash, idempotencyKey: `shaped-${residual}` });
    op = await run(14, "approve").approve(op.operationId); chain.land(chain.node.sends[0]!, chain.node.head - 5n); chain.node.allowance = live.route.amountIn;
    op = await run(11).status(op.operationId); assert.equal(op.phase, "approval_observed"); const approvalGas = op.accumulatedNativeDebitWei;
    // The 0.5.52 stop: the swap marker at nonce 10 is durable and its nonce reserved, nothing signed; then the route expires.
    op = await new UniswapTokenJournal(temporary.root).save(transitionUniswapToken(op, "submission_started", { swapAttempt: tokenAttempt(op, "swap", "10", now) }, now));
    assert.equal(await new UniswapTokenNonceStore(temporary.root).allocate(op, "swap", 10n), "10");
    now = new Date((op.route.deadline + 3_600) * 1000);
    if (!residual) chain.node.allowanceAt = (tag) => tag === "latest" ? "0" : undefined;
    op = await run(15).execute(op.operationId);
    if (!residual) {
      assert.deepEqual([op.phase, op.cleanupReason, op.usageState, op.principalRelease?.kind, chain.node.sends.length, await used()],
        ["cleaned", "zero_allowance_after_effect", "failed_before_effect", "swap_never_signed", 1, "0"]);
      continue;
    }
    assert.deepEqual([op.phase, op.cleanupReason, op.swapAttempt, op.usageState, chain.node.sends.length, await used()],
      ["cleanup_required", "deadline_expired_after_approval", null, "reserved", 1, live.route.amountIn]);
    assert.deepEqual(nonceRows(temporary.root, account), ["approval:9:committed"]);
    op = await run(14, "cleanup").cleanup(op.operationId); assert.deepEqual([op.phase, op.cleanupAttempt?.nonce, chain.node.sends.length], ["cleanup_submitted", "10", 2]);
    const revoke = parseTransaction(chain.node.sends[1]!);
    assert.deepEqual([revoke.nonce, revoke.to?.toLowerCase(), revoke.data], [10, UNISWAP_USDC.toLowerCase(), envelopeOf(op, "cleanup", "10").data]);
    chain.land(chain.node.sends[1]!, chain.node.head - 5n); chain.node.allowance = "0"; op = await run(11).status(op.operationId);
    assert.deepEqual([op.phase, op.usageState, op.principalRelease?.kind, op.accumulatedNativeDebitWei, await used(), chain.node.sends.length],
      ["cleaned", "failed_before_effect", "swap_never_signed", (BigInt(approvalGas) + 42_000n).toString(), "0", 2]);
    assert.equal((await run(11).status(op.operationId)).integrityHash, op.integrityHash);
  }
});

test("QA 0.5.52 live 262d15ed… (USDC) and fc03d78f… (USDT): status releases the principal once the finalized chain holds the cleanup at the swap's nonce", async (t) => {
  for (const live of LIVE.cleaned) {
    const temporary = await temporaryState(); t.after(temporary.cleanup); const op = validateUniswapTokenOperation(live.operation), now = new Date(dayOf(op));
    const c = await captured(temporary.root, op, live.usage, now), cleanup = live.cleanupTransaction, cleanupBlock = BigInt(cleanup.blockNumber!);
    assert.deepEqual([op.phase, op.usageState, op.swapAttempt?.transactionHash, op.swapAttempt?.nonce, BigInt(cleanup.nonce!).toString()],
      ["cleaned", "reserved", null, op.cleanupAttempt!.nonce, op.cleanupAttempt!.nonce]);
    assert.equal(await c.used(), op.route.amountIn, "the captured hold still eats the day's cap");
    c.chain.node.finalizedNonce = BigInt(live.nonceAtFinality); c.chain.node.finalizedLag = 64n;

    // The node does not know the cleanup yet, then knows it above the finalized head: nothing is proven, the hold stays.
    c.chain.node.head = cleanupBlock + 10n; let out = await c.cli("status", 11);
    assert.deepEqual([(out.operation as UniswapTokenOperation).integrityHash, await c.row()], [op.integrityHash, "reserved"]);
    c.chain.node.txs.set(cleanup.hash!, { ...cleanup }); out = await c.cli("status", 11);
    assert.deepEqual([(out.operation as UniswapTokenOperation).integrityHash, await c.row()], [op.integrityHash, "reserved"]);

    c.chain.node.head = BigInt(live.finalizedHead.number) + 64n; out = await c.cli("status", 11); assert.equal(out.ok, true, JSON.stringify(out.error));
    const released = out.operation as UniswapTokenOperation;
    assert.deepEqual(released.principalRelease, { schemaVersion: "apn.uniswap-token-principal-release.v1", kind: "swap_nonce_consumed_by_cleanup",
      swapNonce: op.swapAttempt!.nonce, cleanupTransactionHash: op.cleanupAttempt!.transactionHash, cleanupBlockNumber: cleanupBlock.toString(),
      cleanupBlockHash: cleanup.blockHash, finalizedBlockNumber: BigInt(live.finalizedHead.number).toString(), finalizedNonce: String(live.nonceAtFinality),
      observedAt: now.toISOString() });
    assert.deepEqual([released.phase, released.usageState, released.accumulatedNativeDebitWei, released.preSignFailure, released.cleanupReason],
      ["cleaned", "failed_before_effect", op.accumulatedNativeDebitWei, op.preSignFailure, op.cleanupReason], "gas, diagnostic and history stay");
    for (const field of ["approvalAttempt", "swapAttempt", "cleanupAttempt", "route", "usageReservationId"] as const) assert.deepEqual(released[field], op[field], field);
    assert.deepEqual([await c.row(), await c.used(), c.chain.node.sends.length], ["failed_before_effect", "0", 0]);
    const reads = c.chain.node.methods.length, again = await c.cli("status", 11);
    assert.deepEqual([(again.operation as UniswapTokenOperation).integrityHash, c.chain.node.methods.length], [released.integrityHash, reads], "idempotent, no further reads");
  }
});

test("principal-release evidence that does not prove the swap's nonce spent is refused as corrupt", () => {
  const op = validateUniswapTokenOperation(LIVE.cleaned[0]!.operation), proof = { schemaVersion: "apn.uniswap-token-principal-release.v1", kind: "swap_nonce_consumed_by_cleanup",
    swapNonce: "8", cleanupTransactionHash: op.cleanupAttempt!.transactionHash, cleanupBlockNumber: "26232304", cleanupBlockHash: blockHash(1n),
    finalizedBlockNumber: "26232349", finalizedNonce: "9", observedAt: op.updatedAt };
  const record = (patch: Partial<UniswapTokenOperation>) => { const { integrityHash: _h, ...body } = { ...op, ...patch }; return { ...body, integrityHash: hashObject(body) }; };
  assert.equal(validateUniswapTokenOperation(record({ principalRelease: proof as never })).principalRelease?.kind, "swap_nonce_consumed_by_cleanup");
  for (const forged of [{ ...proof, finalizedNonce: "8" }, { ...proof, finalizedBlockNumber: "26232303" }, { ...proof, cleanupTransactionHash: op.approvalAttempt!.transactionHash },
    { ...proof, swapNonce: "7" }, { schemaVersion: proof.schemaVersion, kind: "swap_never_signed", observedAt: op.updatedAt }])
    assert.throws(() => validateUniswapTokenOperation(record({ principalRelease: forged as never })), { code: "APN_STATE_CORRUPT" }, JSON.stringify(forged));
  assert.throws(() => validateUniswapTokenOperation(record({ principalRelease: proof as never, swapAttempt: { ...op.swapAttempt!, transactionHash: `0x${"1".repeat(64)}` } })),
    { code: "APN_STATE_CORRUPT" }, "a bound swap settles by its own observation");
  assert.throws(() => validateUniswapTokenOperation(record({ principalRelease: proof as never, phase: "cleanup_required" })), { code: "APN_STATE_CORRUPT" });
});

test("a new swap refused before signing, cleaned by one consented revoke, releases its principal and keeps both gas charges", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const key = `0x${"0".repeat(63)}6` as Hex, account = privateKeyToAccount(key).address;
  const at = new Date(), state = new StateStore(temporary.root); await state.initialize(); await new EncryptedWalletStore(state, WRAPPING).importNew("qa0552-new", key, account);
  await activateDirectPolicy(temporary.root, "qa0552-new", { accounts: { evm: account }, now: at, admissions: [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({ chain: "eip155:1",
    kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000", mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
  const chain = movingNode({ account, allowance: "0", pending: 9n }), terminal = typingTerminal(), ledger = new AssetUsageLedger(temporary.root);
  const run = (cap: number, foreground: "approve" | "cleanup" | "refuse" = "refuse") => createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock: { now: () => at },
    call: tokenSession(state, chain, cap), foreground, tty: terminal.tty, verifyPins: pinsLikeProduction });
  const quote = await run(8).quote({ command: "swap.uniswap-token.quote", profile: "qa0552-new", account, recipient: account, sourceToken: UNISWAP_USDC,
    outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "980000", approvalCapAtomic: "1000000", deadline: Math.floor(at.getTime() / 1000) + 600,
    maxApprovalGasLimit: "100000", maxSwapGasLimit: "200000", maxCleanupGasLimit: "70000", maxFeePerGas: "400000000", maxPriorityFeePerGas: "50000000",
    maxNativeDebitWei: "150000000000000" }) as { quoteHash: string };
  let op = await run(9).prepare({ command: "swap.uniswap-token.prepare", profile: "qa0552-new", quoteHash: quote.quoteHash, idempotencyKey: "fee-refused" });
  op = await run(14, "approve").approve(op.operationId); chain.land(chain.node.sends[0]!, chain.node.head - 5n); chain.node.allowance = "1000000";
  op = await run(11).status(op.operationId); const approvalGas = op.accumulatedNativeDebitWei; assert.equal(op.phase, "approval_observed");
  const used = async () => (await ledger.usage({ account, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, at)).amountAtomic;
  assert.equal(await used(), "1000000", "the day's whole cap is held by this swap");

  chain.node.baseFee = 300_000_000n; op = await run(15).execute(op.operationId);
  assert.deepEqual([op.phase, op.preSignFailure?.reason, op.swapAttempt, op.usageState, chain.node.sends.length], ["cleanup_required", "uniswap_token_fee_cap", null, "reserved", 1]);
  chain.node.baseFee = 1n; op = await run(14, "cleanup").cleanup(op.operationId);
  assert.deepEqual([op.phase, op.cleanupAttempt?.nonce, chain.node.sends.length], ["cleanup_submitted", "10", 2]);
  chain.land(chain.node.sends[1]!, chain.node.head - 5n); chain.node.allowance = "0"; op = await run(11).status(op.operationId);
  assert.deepEqual([op.phase, op.usageState, op.principalRelease?.kind, op.swapAttempt], ["cleaned", "failed_before_effect", "swap_never_signed", null]);
  assert.equal(op.accumulatedNativeDebitWei, (BigInt(approvalGas) + 21_000n * 2n).toString(), "approval and cleanup gas stay charged");
  assert.deepEqual([await used(), chain.node.sends.length], ["0", 2]);
  const again = await run(11).status(op.operationId); assert.equal(again.integrityHash, op.integrityHash);
  assert.equal(canonicalJson(again), canonicalJson(op));
});
