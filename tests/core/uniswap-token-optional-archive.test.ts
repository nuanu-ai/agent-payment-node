import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { createTokenRpc, tokenBatch, tokenChain, tokenHex, type TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { UniswapTokenJournal } from "../../src/swap/uniswap-v3/token-operation.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { blockHash, movingNode, pinsLikeProduction, typingTerminal, WRAPPING } from "./uniswap-token-moving-node-harness.js";

// QA F10: a token quote with only APN_ETHEREUM_RPC_URL refused "Historical bridge proof requires an explicitly configured
// archive RPC endpoint" although the docs declare the archive optional. Every read the lane sends on its archive route is
// pinned to a block the same command has just read from the primary, so the primary serves it, as it does for the lane's
// scalar reads and for the native-input lane.

const KEY = `0x${"0".repeat(63)}6` as Hex, ACCOUNT = privateKeyToAccount(KEY).address, PROFILE = "token-primary-only";
const PRIMARY = "https://rpc.example";

/** A pruning node: the listed origins answer eth_call at a block at or below `through` with a JSON-RPC error. */
interface Pruning { through: bigint | null; origins: readonly string[] }
interface SentRow { readonly origin: string; readonly method: string; readonly params: readonly unknown[] }
/** The block a read names: a numeric tag, or an EIP-1898 hash the moving node minted for that number (`blockHash`). */
function namedBlock(tag: unknown): bigint | null {
  if (typeof tag === "string") return /^0x[0-9a-f]+$/u.test(tag) ? BigInt(tag) : null;
  const hash = typeof tag === "object" && tag !== null ? (tag as { readonly blockHash?: unknown }).blockHash : undefined;
  return typeof hash === "string" ? BigInt(`0x${hash.slice(-16)}`) : null;
}
function session(state: StateStore, chain: ReturnType<typeof movingNode>, maxHttpRequests: number,
  environment: Readonly<Record<string, string>>, origins: string[], options: { readonly pruning?: Pruning; readonly sent?: SentRow[] } = {}): TokenRpcCall {
  const node = chain.node, pruning = options.pruning ?? { through: null, origins: [] };
  return createTokenRpc({ environment, state, now: () => node.rpcNow, pacingNow: () => node.rpcNow,
    wait: async (milliseconds) => { node.rpcNow += milliseconds; }, maxHttpRequests, deadlineMs: 300_000,
    transport: { request: async (url: string, method: string, body: string | null) => { const origin = new URL(url).origin; origins.push(origin);
      const sent = JSON.parse(body!) as unknown;
      const requests = (Array.isArray(sent) ? sent : [sent]) as { readonly id: string; readonly method: string; readonly params: readonly unknown[] }[];
      options.sent?.push(...requests.map((row) => ({ origin, method: row.method, params: row.params })));
      const response = await chain.request(url, method, body), through = pruning.through;
      if (through === null || !pruning.origins.includes(origin)) return response;
      const answered = JSON.parse(response.body) as unknown, answers = (Array.isArray(answered) ? answered : [answered]) as { readonly id: string }[];
      const pruned = (id: string) => { const row = requests.find((request) => request.id === id)!, block = namedBlock(row.params[1]);
        return row.method === "eth_call" && block !== null && block <= through; };
      const rows = answers.map((answer) => pruned(answer.id) ? { jsonrpc: "2.0", id: answer.id, error: { code: -32000, message: "missing trie node" } } : answer);
      return { ...response, body: JSON.stringify(Array.isArray(answered) ? rows : rows[0]) }; } } });
}
const pinnedRead = [{ method: "eth_getCode", params: [ACCOUNT, "0x10"], cachePolicy: "none" as const, decoder: tokenHex() }];
const receiptRead = [{ method: "eth_chainId", params: [], cachePolicy: "none" as const, decoder: tokenChain },
  { method: "eth_getTransactionReceipt", params: [`0x${"a".repeat(64)}`], cachePolicy: "none" as const, decoder: (value: unknown) => value }];

test("a token swap quotes, prepares, approves and observes with the primary RPC alone (scalar and pooled)", async (t) => {
  for (const environment of [{ APN_ETHEREUM_RPC_URL: PRIMARY }, { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify([PRIMARY]) }]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const at = new Date(), state = new StateStore(temporary.root); await state.initialize();
    await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
    await activateDirectPolicy(temporary.root, PROFILE, { accounts: { evm: ACCOUNT }, now: at, admissions: [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({
      chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "3000000",
      mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
    const chain = movingNode({ account: ACCOUNT, allowance: "0", pending: 9n }), terminal = typingTerminal(), origins: string[] = [];
    const run = (maxHttpRequests: number, foreground: "approve" | "refuse" = "refuse") => {
      const call = session(state, chain, maxHttpRequests, environment, origins);
      return { call, runtime: createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock: { now: () => at }, call, foreground, tty: terminal.tty,
        verifyPins: pinsLikeProduction }) };
    };
    const archiveFree = (call: TokenRpcCall) => {
      const roles = call.telemetry!()!.attemptsByEndpointRole;
      assert.deepEqual([roles.archive, roles.receipt], [0, 0], JSON.stringify(roles));
    };
    let step = run(8);
    const quote = await step.runtime.quote({ command: "swap.uniswap-token.quote", profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT,
      sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000", approvalCapAtomic: "1000000",
      deadline: Math.floor(at.getTime() / 1000) + 600, maxApprovalGasLimit: "100000", maxSwapGasLimit: "200000", maxCleanupGasLimit: "100000",
      maxFeePerGas: "4", maxPriorityFeePerGas: "1", maxNativeDebitWei: "1600000" }) as { quoteHash: string };
    archiveFree(step.call);
    step = run(9);
    let op = await step.runtime.prepare({ command: "swap.uniswap-token.prepare", profile: PROFILE, quoteHash: quote.quoteHash, idempotencyKey: "token-primary-only-1" });
    archiveFree(step.call);
    step = run(14, "approve"); op = await step.runtime.approve(op.operationId);
    assert.equal(op.phase, "approval_submitted"); archiveFree(step.call);
    chain.land(chain.node.sends.at(-1)!, chain.node.head - 5n); chain.node.allowance = "1000000";
    step = run(11); op = await step.runtime.status(op.operationId);
    assert.equal(op.phase, "approval_observed"); archiveFree(step.call);
    assert.deepEqual([...new Set(origins)], [PRIMARY]);
  }
});

test("a configured archive or receipt reader still serves its own reads; without them the primary does", async (t) => {
  const pinned = pinnedRead, receipt = receiptRead;
  for (const [environment, archive, receiptReader] of [
    [{ APN_ETHEREUM_RPC_URL: PRIMARY }, PRIMARY, PRIMARY],
    [{ APN_ETHEREUM_RPC_URL: PRIMARY, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" }, "https://archive.example", "https://archive.example"],
    [{ APN_ETHEREUM_RPC_URL: PRIMARY, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example", APN_ETHEREUM_RECEIPT_RPC_URL: "https://receipt.example" },
      "https://archive.example", "https://receipt.example"],
  ] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const state = new StateStore(temporary.root), chain = movingNode({ account: ACCOUNT, allowance: "0", pending: 0n }), origins: string[] = [];
    const call = session(state, chain, 6, environment, origins);
    await tokenBatch(call, "archive", pinned);
    assert.deepEqual([...new Set(origins)], [archive], JSON.stringify(environment)); origins.length = 0;
    assert.equal((await tokenBatch(call, "receipt", receipt))[1], null);
    assert.deepEqual([...new Set(origins)], [receiptReader], JSON.stringify(environment));
  }
});

test("a late status on a pruning primary names the archive setting and the status command, and records nothing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const at = new Date(), state = new StateStore(temporary.root); await state.initialize();
  await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
  await activateDirectPolicy(temporary.root, PROFILE, { accounts: { evm: ACCOUNT }, now: at, admissions: [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({
    chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "3000000",
    mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
  const chain = movingNode({ account: ACCOUNT, allowance: "0", pending: 9n }), terminal = typingTerminal(), origins: string[] = [];
  const ARCHIVE = "https://archive.example", primaryOnly = { APN_ETHEREUM_RPC_URL: PRIMARY }, withArchive = { ...primaryOnly, APN_ETHEREUM_ARCHIVE_RPC_URL: ARCHIVE };
  const pruning: Pruning = { through: null, origins: [PRIMARY] };
  const runtime = (maxHttpRequests: number, environment: Readonly<Record<string, string>> = primaryOnly, foreground: "approve" | "refuse" = "refuse") =>
    createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock: { now: () => at }, call: session(state, chain, maxHttpRequests, environment, origins, { pruning }),
      foreground, tty: terminal.tty, verifyPins: pinsLikeProduction });
  const quote = await runtime(8).quote({ command: "swap.uniswap-token.quote", profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT,
    sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000", approvalCapAtomic: "1000000",
    deadline: Math.floor(at.getTime() / 1000) + 600, maxApprovalGasLimit: "100000", maxSwapGasLimit: "200000", maxCleanupGasLimit: "100000",
    maxFeePerGas: "4", maxPriorityFeePerGas: "1", maxNativeDebitWei: "1600000" }) as { quoteHash: string };
  let op = await runtime(9).prepare({ command: "swap.uniswap-token.prepare", profile: PROFILE, quoteHash: quote.quoteHash, idempotencyKey: "token-pruned-status-1" });
  op = await runtime(14, primaryOnly, "approve").approve(op.operationId); assert.equal(op.phase, "approval_submitted");
  const approval = chain.node.sends.at(-1)!, near = chain.node.head - 5n; chain.land(approval, near); chain.node.allowance = "1000000";
  // A refusal of a block well within what a pruning node keeps (a backend behind, a revert reported as -32000) is not
  // an archive question: it passes through as the primary's own error.
  pruning.through = near;
  await assert.rejects(runtime(11).status(op.operationId), (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_PROTOCOL" &&
    error.details?.providerCode === -32000 && error.details?.reason !== "uniswap_token_status_archive_required");
  // The same approval seen in a block 198 behind the safe head, whose state the primary no longer keeps.
  const landed = chain.node.head - 200n; chain.land(approval, landed); pruning.through = landed;
  const refused = await new ApnCore({ state, clock: { now: () => at }, uniswapTokenRuntime: runtime(11) })
    .execute({ command: "swap.uniswap-token.status", operationId: op.operationId });
  assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  assert.deepEqual(refused.error?.details, { reason: "uniswap_token_status_archive_required", endpointRole: "primary", blockNumber: landed.toString(),
    safeBlockNumber: (chain.node.head - 2n).toString(), rpcMethod: "eth_call", providerCode: -32000, nextActions: refused.next_actions });
  assert.match(refused.error?.message ?? "", /APN_ETHEREUM_ARCHIVE_RPC_URL/u); assert.doesNotMatch(refused.error?.message ?? "", /[Bb]ridge/u);
  assert.deepEqual(refused.next_actions, ["Set APN_ETHEREUM_ARCHIVE_RPC_URL to a public HTTPS Ethereum archive endpoint, then run status again.",
    `apn swap ethereum uniswap-token status --operation ${op.operationId}`]);
  assert.equal((await new UniswapTokenJournal(temporary.root).load(op.operationId))?.phase, "approval_submitted", "the refusal records nothing");
  // A configured archive that refuses is reported as it is: the wrapper speaks only for the primary standing in for one.
  pruning.origins = [ARCHIVE];
  await assert.rejects(runtime(11, withArchive).status(op.operationId), (error: unknown) =>
    error instanceof Error && (error as { code?: string }).code === "APN_RPC_PROTOCOL");
  // With a working archive the same status completes from the archive's state.
  pruning.through = null;
  assert.equal((await runtime(11, withArchive).status(op.operationId)).phase, "approval_observed");
  assert.ok(origins.includes(ARCHIVE));
});

test("with a primary pool and no archive, a stand-in batch before the pool selected its provider refuses and probes nothing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), chain = movingNode({ account: ACCOUNT, allowance: "0", pending: 0n }), origins: string[] = [];
  const call = session(state, chain, 6, { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify([PRIMARY, "https://second.example"]) }, origins);
  for (const [route, items] of [["archive", pinnedRead], ["receipt", receiptRead]] as const) {
    await assert.rejects(tokenBatch(call, route, items), { code: "APN_RPC_CONFIG", details: { reason: "token_primary_not_selected", rpcRoute: route } });
  }
  assert.deepEqual(origins, [], "no candidate was probed, so none could be quarantined or skipped");
  await tokenBatch(call, "primary", [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain }]);
  await tokenBatch(call, "archive", pinnedRead); assert.equal((await tokenBatch(call, "receipt", receiptRead))[1], null);
  assert.deepEqual([...new Set(origins)], [PRIMARY], "the selected provider serves the stand-in batches");
});

test("state reads the primary serves are pinned by block hash at quote, prepare and the signing guard, within the same budgets", async (t) => {
  for (const environment of [{ APN_ETHEREUM_RPC_URL: PRIMARY }, { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify([PRIMARY]) }]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const at = new Date(), state = new StateStore(temporary.root); await state.initialize();
    await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
    await activateDirectPolicy(temporary.root, PROFILE, { accounts: { evm: ACCOUNT }, now: at, admissions: [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({
      chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "3000000",
      mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
    const chain = movingNode({ account: ACCOUNT, allowance: "0", pending: 9n }), terminal = typingTerminal(), origins: string[] = [], sent: SentRow[] = [];
    const runtime = (maxHttpRequests: number, foreground: "approve" | "refuse" = "refuse") => createUniswapTokenRuntime({ state, wrapping: WRAPPING,
      clock: { now: () => at }, call: session(state, chain, maxHttpRequests, environment, origins, { sent }), foreground, tty: terminal.tty, verifyPins: pinsLikeProduction });
    const quote = await runtime(8).quote({ command: "swap.uniswap-token.quote", profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT,
      sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000", approvalCapAtomic: "1000000",
      deadline: Math.floor(at.getTime() / 1000) + 600, maxApprovalGasLimit: "100000", maxSwapGasLimit: "200000", maxCleanupGasLimit: "100000",
      maxFeePerGas: "4", maxPriorityFeePerGas: "1", maxNativeDebitWei: "1600000" }) as { quoteHash: string };
    let op = await runtime(9).prepare({ command: "swap.uniswap-token.prepare", profile: PROFILE, quoteHash: quote.quoteHash, idempotencyKey: "token-pinned-1" });
    op = await runtime(14, "approve").approve(op.operationId); assert.equal(op.phase, "approval_submitted", JSON.stringify(environment));
    // Every state read names its block by hash; only reads of the moving head ("latest") carry no block of their own.
    const stateReads = sent.filter((row) => ["eth_call", "eth_getCode", "eth_getStorageAt", "eth_getBalance"].includes(row.method));
    const pinned = stateReads.filter((row) => row.params.at(-1) !== "latest");
    assert.ok(pinned.length >= 10, `${pinned.length} pinned state reads`);
    for (const row of pinned) {
      const tag = row.params.at(-1);
      assert.equal(typeof tag, "object", `${row.method} at ${String(tag)} is pinned by hash, not by number`);
      assert.deepEqual(tag, { blockHash: blockHash(namedBlock(tag)!), requireCanonical: true }, row.method);
    }
    // EIP-1898 defines no block hash for eth_estimateGas: it keeps the number of the same block.
    for (const row of sent.filter((entry) => entry.method === "eth_estimateGas")) assert.match(String(row.params[1]), /^0x[0-9a-f]+$/u);
    assert.deepEqual([...new Set(origins)], [PRIMARY]);
  }
});

test("a directly read block keeps its first hash, a parent hash only fills an unread number, and two hashes for one block refuse", async (t) => {
  const A = `0x${"a".repeat(64)}`, P = `0x${"c".repeat(64)}`, B = `0x${"d".repeat(64)}`, X = `0x${"e".repeat(64)}`;
  for (const environment of [{ APN_ETHEREUM_RPC_URL: PRIMARY }, { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify([PRIMARY]) }]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    // The primary's answers: "latest" is whatever block the step sets; a numeric tag answers the blocks listed in `byNumber`.
    let latest: Record<string, string> = { number: "0x10", hash: A, parentHash: P };
    const byNumber = new Map<string, Record<string, string>>(), sent: SentRow[] = [];
    const call = createTokenRpc({ environment, state: new StateStore(temporary.root), now: Date.now, maxHttpRequests: 12, deadlineMs: 10_000,
      transport: { request: async (url: string, _method: string, body: string | null) => { const parsed = JSON.parse(body!) as unknown;
        const rows = (Array.isArray(parsed) ? parsed : [parsed]) as { readonly id: string; readonly method: string; readonly params: readonly unknown[] }[];
        sent.push(...rows.map((row) => ({ origin: new URL(url).origin, method: row.method, params: row.params })));
        const answers = rows.map((row) => ({ jsonrpc: "2.0", id: row.id, result: row.method === "eth_chainId" ? "0x1" : row.method === "eth_getCode" ? "0x6000"
          : row.params[0] === "latest" ? latest : byNumber.get(String(row.params[0])) ?? null }));
        return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? answers : answers[0]) }; } } });
    const code = (tag: string) => [{ method: "eth_getCode", params: [ACCOUNT, tag], cachePolicy: "none" as const, decoder: tokenHex() }];
    const block = (tag: string) => [{ method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "none" as const, decoder: (value: unknown) => value }];
    const pinnedTo = () => sent.filter((row) => row.method === "eth_getCode").map((row) => row.params[1]);
    await tokenBatch(call, "primary", [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain }, ...block("latest")]);
    // Precedence: block 0x10 was read directly (A); 0xf is known only as its parent (P) and fills that unread number.
    await tokenBatch(call, "archive", code("0x10")); await tokenBatch(call, "archive", code("0xf"));
    assert.deepEqual(pinnedTo(), [{ blockHash: A, requireCanonical: true }, { blockHash: P, requireCanonical: true }], JSON.stringify(environment));
    // A direct read of 0xf that agrees with its parent entry keeps it; a later block whose parent agrees with 0x10 changes nothing.
    byNumber.set("0xf", { number: "0xf", hash: P, parentHash: X }); await tokenBatch(call, "primary", block("0xf"));
    latest = { number: "0x11", hash: B, parentHash: A }; await tokenBatch(call, "primary", block("latest"));
    sent.length = 0; await tokenBatch(call, "archive", code("0x10")); await tokenBatch(call, "archive", code("0xf"));
    assert.deepEqual(pinnedTo(), [{ blockHash: A, requireCanonical: true }, { blockHash: P, requireCanonical: true }]);
    // A one-time inconsistent answer: the next block names another parent for 0x10. Neither hash is chosen; nothing is sent.
    latest = { number: "0x12", hash: `0x${"f".repeat(64)}`, parentHash: X }; byNumber.set("0x11", { number: "0x11", hash: B, parentHash: X });
    await tokenBatch(call, "primary", block("0x11"));
    sent.length = 0;
    await assert.rejects(tokenBatch(call, "archive", code("0x10")), { code: "APN_RPC_PROTOCOL",
      details: { reason: "token_primary_block_hash_conflict", blockNumber: "16" } });
    await assert.rejects(call("eth_call", [{ to: ACCOUNT, data: "0x" }, "0x10"]), { code: "APN_RPC_PROTOCOL",
      details: { reason: "token_primary_block_hash_conflict", blockNumber: "16" } });
    assert.deepEqual(sent, [], "a conflicted block is never read");
    // The block whose own hash was read directly is unaffected by the conflict one below it.
    await tokenBatch(call, "archive", code("0x11")); assert.deepEqual(pinnedTo(), [{ blockHash: B, requireCanonical: true }]);
  }
});
