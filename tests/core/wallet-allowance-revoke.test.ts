import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { decodeFunctionData, parseAbi, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { idempotency, seal } from "../../src/asset-usage-ledger-record.js";
import { sha256 } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import { bindArgv } from "../../src/command-binder.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { newUniswapTokenOperation, tokenAttempt, transitionUniswapToken, UniswapTokenJournal, validateUniswapTokenOperation,
  type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN, UNISWAP_V3_SWAP_ROUTER } from "../../src/swap/uniswap-v3/token-route.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { walletAllowanceRevokeCommand, walletAllowanceStatusCommand } from "../../src/wallet-allowance/view.js";
import { WalletAllowanceRevokeRepository } from "../../src/wallet-allowance/repository.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { blockHash, CapturedState, movingNode, pinsLikeProduction, tokenSession, typingTerminal, usageBucket, WRAPPING } from "./uniswap-token-qa0552-harness.js";
import { allowanceRpc } from "./wallet-allowance-helpers.js";

const LIVE = JSON.parse(readFileSync("tests/core/fixtures/uniswap-token-qa0552.json", "utf8")) as { expiredCleaned: { operation: UniswapTokenOperation } };
const KEY = `0x${"0".repeat(63)}9` as Hex, ACCOUNT = privateKeyToAccount(KEY).address, PROFILE = "qa0552-revoke";
const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const usageKey = (op: UniswapTokenOperation) => `apn.uniswap-token-usage:${op.operationId}`;
const identity = (op: UniswapTokenOperation) => ({ account: op.account, chain: "eip155:1", asset: { kind: "token" as const, identifier: op.route.inputToken } });
const statusArgv = (op: UniswapTokenOperation) => ["swap", "ethereum", "uniswap-token", "status", "--operation", op.operationId];

/** The Uniswap token status a CLI process runs, over the fake Ethereum node. */
async function uniswapStatus(root: string, chain: ReturnType<typeof movingNode>, op: UniswapTokenOperation): Promise<OutputEnvelope> {
  const state = new StateStore(root), clock = { now: () => new Date() };
  const runtime = createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock, call: tokenSession(state, chain, 11), foreground: "refuse", verifyPins: pinsLikeProduction });
  return await createApnCore(bindArgv(statusArgv(op)), { stateRoot: root, wrappingSecret: WRAPPING, clock, uniswapTokenRuntime: runtime }).execute(bindArgv(statusArgv(op)).request);
}

test("QA 0.5.52 live ea09a115…: the cleaned USDT swap shows its standing 10000 approval and names the exact revoke", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const op = validateUniswapTokenOperation(LIVE.expiredCleaned.operation);
  assert.deepEqual([op.phase, op.cleanupEvidence?.kind, op.usageState, op.route.inputToken, op.route.router], ["cleaned", "expired_approval_no_swap",
    "failed_before_effect", ETHEREUM_USDT, UNISWAP_V3_SWAP_ROUTER]);
  const state = new StateStore(temporary.root); await state.initialize(); await new UniswapTokenJournal(temporary.root).save(op);
  assert.equal(assetUsageReservationId(identity(op), usageKey(op)), op.usageReservationId);
  await new CapturedState(temporary.root).put(usageBucket(op.account, op.route.inputToken), `${op.usageReservationId}.json`, seal({
    schemaVersion: "apn.asset-usage-reservation.v1", ...identity(op), reservationId: op.usageReservationId!, idempotencyHash: idempotency(usageKey(op)),
    policyDigest: op.policyDigest, registryVersion: "qa.052.receiver.captured", rail: "swap", amountAtomic: op.route.amountIn, reservedAt: op.createdAt,
    updatedAt: op.updatedAt, state: "failed_before_effect", effectAt: null, outcomeDigest: sha256("captured-outcome") }));
  const chain = movingNode({ account: op.account, allowance: op.route.amountIn, pending: 7n }), out = await uniswapStatus(temporary.root, chain, op);
  const revoke = walletAllowanceRevokeCommand({ profile: op.profile, chainId: 1, token: ETHEREUM_USDT, spender: UNISWAP_V3_SWAP_ROUTER });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.deepEqual([out.data, out.next_actions], [{ residualAllowance: { chain: "eip155:1", token: ETHEREUM_USDT, owner: op.account,
    spender: UNISWAP_V3_SWAP_ROUTER, allowanceAtomic: "10000", readAt: "latest" } }, [revoke]]);
  assert.equal(revoke, `apn wallet allowance revoke --profile qa-20261013-evm-recv --chain eip155:1 --token ${ETHEREUM_USDT} --spender ${UNISWAP_V3_SWAP_ROUTER} ` +
    "--max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>");
  assert.equal((out.operation as UniswapTokenOperation).integrityHash, op.integrityHash, "status reads; the record is unchanged");
  assert.deepEqual(chain.node.sends, []);
});

/** A swap the 0.5.52 exit cleaned with its approval standing, shaped like ea09a115… (USDT→USDC, 10000), for a test signer. */
async function residualSwap(root: string) {
  const at = new Date(), state = new StateStore(root); await state.initialize(); await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
  const policy = await activateDirectPolicy(root, PROFILE, { accounts: { evm: ACCOUNT }, now: at, admissions: [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({
    chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000", mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
  const live = LIVE.expiredCleaned.operation, journal = new UniswapTokenJournal(root), usage = new UniswapTokenUsage(state, { now: () => at }, new AssetUsageLedger(root));
  let op = await journal.save(newUniswapTokenOperation({ operationId: "e".repeat(64), profile: PROFILE, account: ACCOUNT, route: createUniswapTokenRoute({
    inputToken: ETHEREUM_USDT, outputToken: UNISWAP_USDC, recipient: ACCOUNT, amountIn: live.route.amountIn, amountOutMinimum: live.route.amountOutMinimum,
    deadline: Math.floor(at.getTime() / 1000) + 600 }), approvalCapAtomic: live.approvalCapAtomic, allowanceAtPrepare: "0", approvalGas: live.approvalGas,
  swapGas: live.swapGas, cleanupGas: live.cleanupGas, maximumNativeDebitWei: live.maximumNativeDebitWei, policyDigest: policy.policyDigest,
  mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), quoteBlock: live.quoteBlock!, now: at }));
  const lease = await usage.reserve(op), save = async (next: UniswapTokenOperation) => op = await journal.save(next);
  await save(transitionUniswapToken(op, "approved", { usageReservationId: lease.reservationId, usageState: lease.state }, at));
  const attempt = tokenAttempt(op, "approval", "9", at);
  await save(transitionUniswapToken(op, "approval_submission_started", { approvalAttempt: attempt }, at));
  await save(transitionUniswapToken(op, "approval_submitted", { approvalAttempt: { ...attempt, transactionHash: live.approvalAttempt!.transactionHash } }, at));
  await save(transitionUniswapToken(op, "approval_observed", { accumulatedNativeDebitWei: live.accumulatedNativeDebitWei }, at));
  const later = new Date((op.route.deadline + 60) * 1000);
  await save(transitionUniswapToken(op, "cleaned", { cleanupReason: "deadline_expired_after_approval", cleanupEvidence: { schemaVersion: "apn.uniswap-token-expired-approval-evidence.v1",
    kind: "expired_approval_no_swap", approvalTransactionHash: live.approvalAttempt!.transactionHash!, observedAllowanceAtomic: live.route.amountIn, observedAt: later.toISOString() } }, later));
  const released = await usage.follow(op, "failed_before_effect");
  return await save(transitionUniswapToken(op, "cleaned", { usageReservationId: released.reservationId, usageState: released.state }, later));
}

test("wallet allowance revoke: the residual's named revoke sends approve(router, 0) once, a replay never resends, proof closes it, a second is nothing to do", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const op = await residualSwap(temporary.root);
  const chain = movingNode({ account: ACCOUNT, allowance: "10000", pending: 10n }), terminal = typingTerminal(), posts: string[] = [];
  const options = { stateRoot: temporary.root, wrappingSecret: WRAPPING, clock: { now: () => new Date() }, walletAllowanceRpc: () => allowanceRpc(chain, posts),
    walletAllowanceTtyOptions: terminal.tty, finalizedRead: () => allowanceRpc(chain, posts) };
  const target = ["--profile", PROFILE, "--chain", "eip155:1", "--token", ETHEREUM_USDT, "--spender", UNISWAP_V3_SWAP_ROUTER];
  const revoke = ["wallet", "allowance", "revoke", ...target, "--max-gas-limit", "60000", "--max-fee-per-gas-wei", "2000000000", "--max-priority-fee-per-gas-wei", "1000000"];

  const named = await uniswapStatus(temporary.root, chain, op), command = named.next_actions[0]!;
  assert.deepEqual(named.next_actions, [walletAllowanceRevokeCommand({ profile: PROFILE, chainId: 1, token: ETHEREUM_USDT, spender: UNISWAP_V3_SWAP_ROUTER })]);
  const filled = command.replace("<uint>", "60000").replace("<wei>", "2000000000").replace("<wei>", "1000000").split(" ").slice(1);
  assert.deepEqual(filled, revoke, "the named command is exactly the revoke this test runs");
  let read = await runCli(["wallet", "allowance", "status", ...target], process.env, options);
  assert.equal(read.ok, true, JSON.stringify(read.error));
  assert.deepEqual([(read.data as { allowance_atomic: string }).allowance_atomic, read.next_actions], ["10000", [command]]);

  posts.length = 0; let out = await runCli(revoke, process.env, options), view = out.data as { operation_id: string; state: string; transaction_hash: string };
  assert.equal(out.ok, true, JSON.stringify(out.error)); assert.equal(view.state, "submitted");
  assert.deepEqual(posts, ["eth_chainId,eth_getBlockByNumber", "eth_getTransactionCount,eth_getTransactionCount,eth_call,eth_getBalance,eth_getCode,eth_estimateGas", "send"]);
  const shown = terminal.screens.at(-1)!;
  for (const line of ["Chain: eip155:1", `Token: ${ETHEREUM_USDT}`, `Spender: ${UNISWAP_V3_SWAP_ROUTER}`, "Current allowance: 10000 atomic", "maximum gas debit 120000000000000 wei"])
    assert.ok(shown.includes(line), line);
  assert.equal(chain.node.sends.length, 1); const signed = parseTransaction(chain.node.sends[0]!);
  assert.deepEqual([signed.nonce, signed.to?.toLowerCase(), signed.value ?? 0n, decodeFunctionData({ abi: ERC20, data: signed.data! }).args],
    [10, ETHEREUM_USDT.toLowerCase(), 0n, [UNISWAP_V3_SWAP_ROUTER, 0n]]);

  // A replay continues the same open revoke: it observes (nothing landed yet) and never sends again.
  out = await runCli(revoke, process.env, options);
  assert.deepEqual([(out.data as { operation_id: string }).operation_id, (out.data as { state: string }).state, chain.node.sends.length], [view.operation_id, "submitted", 1]);
  chain.land(chain.node.sends[0]!, chain.node.head - 5n); chain.node.allowance = "0";
  out = await runCli(["operation", "status", "--operation", view.operation_id], process.env, options);
  const done = out.data as { state: string; outcome: { kind: string; status: string; approvalLog: boolean; allowanceAtTagAtomic: string; tag: string } };
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.deepEqual([done.state, done.outcome.kind, done.outcome.status, done.outcome.approvalLog, done.outcome.allowanceAtTagAtomic, done.outcome.tag],
    ["completed", "receipt", "success", true, "0", "safe"]);

  out = await runCli(revoke, process.env, options);
  assert.deepEqual([out.ok, out.error?.details?.reason, chain.node.sends.length], [false, "wallet_allowance_nothing_to_revoke", 1], JSON.stringify(out.error));
  assert.equal(readdirSync(`${temporary.root}/wallet-allowance-revokes`).filter((name) => name.endsWith(".json")).length, 1, "no new record");
  read = await runCli(["wallet", "allowance", "status", ...target], process.env, options);
  assert.deepEqual([(read.data as { allowance_atomic: string }).allowance_atomic, read.next_actions], ["0", []]);
  const clean = await uniswapStatus(temporary.root, chain, op);
  assert.deepEqual([clean.data, clean.next_actions], [null, []]);

  // MCP reads the allowance and hands the revoke to the CLI.
  const server = createMcpServer(options), pair = InMemoryTransport.createLinkedPair(); await server.connect(pair[1]);
  const client = new Client({ name: "wallet-allowance", version: "1" }); await client.connect(pair[0]); t.after(async () => { await client.close(); await server.close(); });
  const text = (result: Awaited<ReturnType<Client["callTool"]>>) => { const content = result.content[0]; return JSON.parse(content?.type === "text" ? content.text : "{}") as OutputEnvelope; };
  const args = { profile: PROFILE, chain: "eip155:1", token: ETHEREUM_USDT, spender: UNISWAP_V3_SWAP_ROUTER };
  assert.equal((text(await client.callTool({ name: "apn_wallet_allowance_status", arguments: args })).data as { allowance_atomic: string }).allowance_atomic, "0");
  const handoff = text(await client.callTool({ name: "apn_foreground_handoff", arguments: { command: "wallet allowance revoke", arguments: { ...args,
    max_gas_limit: "60000", max_fee_per_gas_wei: "2000000000", max_priority_fee_per_gas_wei: "1000000" } } }));
  assert.deepEqual([handoff.error?.code, handoff.error?.details?.cli_handoff], ["APN_FOREGROUND_APPROVAL_REQUIRED", `apn ${revoke.join(" ")}`]);
  assert.equal(chain.node.sends.length, 1);
});

test("wallet allowance revoke: a sent revoke the chain can never include ends superseded (era indexed); the owner abandons one no proof decides", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize(); await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
  const chain = movingNode({ account: ACCOUNT, allowance: "10000", pending: 10n }), terminal = typingTerminal(), approvals: string[] = [];
  const options = { stateRoot: temporary.root, wrappingSecret: WRAPPING, clock: { now: () => new Date() }, walletAllowanceRpc: () => allowanceRpc(chain),
    walletAllowanceTtyOptions: terminal.tty, finalizedRead: () => allowanceRpc(chain),
    operationAbandonApproval: { approve: async (intent: { readonly assetLabel: string }) => { approvals.push(intent.assetLabel); } } };
  const target = { profile: PROFILE, chainId: 1, token: ETHEREUM_USDT, spender: UNISWAP_V3_SWAP_ROUTER };
  const revoke = ["wallet", "allowance", "revoke", "--profile", PROFILE, "--chain", "eip155:1", "--token", ETHEREUM_USDT, "--spender", UNISWAP_V3_SWAP_ROUTER,
    "--max-gas-limit", "60000", "--max-fee-per-gas-wei", "2000000000", "--max-priority-fee-per-gas-wei", "1000000"];
  const view = (out: OutputEnvelope) => out.data as { operation_id: string; state: string; outcome: { kind: string } | null; next_actions: string[] };
  const status = async (id: string) => await runCli(["operation", "status", "--operation", id], process.env, options);

  const first = view(await runCli(revoke, process.env, options)), era = (await new WalletAllowanceRevokeRepository(temporary.root).required(first.operation_id)).terms.era;
  assert.deepEqual([first.state, chain.node.sends.length], ["submitted", 1]);
  // Another transaction of the wallet took nonce 10 and is finalized; the revoke itself is unknown to the node.
  chain.node.pending = 11n; chain.node.finalizedNonce = 11n;
  assert.equal(view(await status(first.operation_id)).state, "submitted", "a node that does not index the era block proves nothing");
  const probe = `0x${"c".repeat(64)}`;
  chain.node.txs.set(probe, { hash: probe, blockHash: blockHash(BigInt(era.number)), blockNumber: `0x${BigInt(era.number).toString(16)}` });
  const ended = view(await status(first.operation_id));
  assert.deepEqual([ended.state, ended.outcome?.kind, ended.next_actions], ["superseded", "never_lands", [walletAllowanceRevokeCommand(target)]]);

  // The allowance still stands: the named revoke is a new operation at the next nonce, sent once; the owner abandons it.
  const second = view(await runCli(revoke, process.env, options));
  assert.notEqual(second.operation_id, first.operation_id);
  assert.deepEqual([second.state, chain.node.sends.length, parseTransaction(chain.node.sends[1]!).nonce], ["submitted", 2, 11]);
  const abandoned = await runCli(["operation", "abandon", "--operation", second.operation_id], process.env, options);
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error));
  assert.deepEqual([(abandoned.operation as { state: string }).state, abandoned.next_actions, approvals],
    ["abandoned_unknown", [walletAllowanceStatusCommand(target)], [`allowance of ${ETHEREUM_USDT} to ${UNISWAP_V3_SWAP_ROUTER}`]]);
  const entry = await new OperationIndex(new SecureStateStore(temporary.root)).find(second.operation_id);
  assert.deepEqual([entry?.state, entry?.claims], ["terminal", []]);
  assert.equal(chain.node.sends.length, 2, "neither status nor abandon sends");
});

test("wallet allowance commands need the chain's own RPC setting and refuse by name", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const saved = process.env.APN_ETHEREUM_RPC_URL; delete process.env.APN_ETHEREUM_RPC_URL;
  t.after(() => { if (saved !== undefined) process.env.APN_ETHEREUM_RPC_URL = saved; });
  const target = (chain: string) => ["--profile", "default", "--chain", chain, "--token", ETHEREUM_USDT, "--spender", UNISWAP_V3_SWAP_ROUTER];
  const unset = await runCli(["wallet", "allowance", "status", ...target("eip155:1")], process.env, { stateRoot: temporary.root });
  assert.deepEqual([unset.error?.code, unset.error?.details?.reason, unset.error?.details?.setting], ["APN_RPC_CONFIG", "wallet_allowance_rpc_required", "APN_ETHEREUM_RPC_URL"]);
  assert.match(unset.next_actions[0] ?? "", /APN_ETHEREUM_RPC_URL/u);
  const unknown = await runCli(["wallet", "allowance", "revoke", ...target("eip155:999999"), "--max-gas-limit", "60000", "--max-fee-per-gas-wei", "2", "--max-priority-fee-per-gas-wei", "1"],
    process.env, { stateRoot: temporary.root });
  assert.deepEqual([unknown.error?.code, unknown.error?.details?.reason], ["APN_RPC_CONFIG", "wallet_allowance_chain_rpc_setting_unknown"]);
});
