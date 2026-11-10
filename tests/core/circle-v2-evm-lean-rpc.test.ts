/** Phase-2 public-RPC diet of the live Circle rails: physical POST and call counts from a mock JSON-RPC transport. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult, getAddress, type Hex } from "viem";
import { CIRCLE_MESSENGER, CIRCLE_MINTER, CIRCLE_SOURCE_TOKEN, CIRCLE_TRANSMITTER, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { circleTokenPairKey, verifyCircleDeployments } from "../../src/circle-v2-evm/preflight.js";
import { circleWord } from "../../src/circle-v2-evm/protocol.js";
import { CIRCLE_COMMAND_REQUEST_BUDGET, CIRCLE_RPC_ABI, CircleRpc, readCircleAttesters, readCircleDeployment } from "../../src/circle-v2-evm/rpc.js";
import { CircleExternalRpc, CircleExternalRpcBudget } from "../../src/circle-v2-evm/external-rpc.js";
import { ApnError } from "../../src/errors.js";
import { failureEnvelope } from "../../src/output.js";

const hash = `0x${"11".repeat(32)}` as Hex, blockHash = `0x${"22".repeat(32)}` as Hex;
type Call = { readonly id: number; readonly method: string; readonly params: readonly unknown[] };
function transport(chainId: number, peer = 143) {
  const posts: Call[][] = [];
  const answer = (q: Call): unknown => {
    if (q.method === "eth_chainId") return `0x${chainId.toString(16)}`;
    if (q.method === "eth_getBlockByNumber") return { number: "0x10", hash: blockHash, baseFeePerGas: "0x1", transactions: [hash] };
    if (q.method === "eth_getTransactionByHash") return { hash, blockHash, blockNumber: "0xa" };
    if (q.method === "eth_getTransactionReceipt") return { transactionHash: hash, blockHash, blockNumber: "0xa", status: "0x1", logs: [] };
    if (q.method !== "eth_call") throw Error(`unexpected ${q.method}`);
    const tx = q.params[0] as { to: string; data: Hex }, decoded = decodeFunctionData({ abi: CIRCLE_RPC_ABI, data: tx.data }), source = chainId === 42161, route = circleRoute(peer as 143);
    const value = ({ localDomain: source ? 3 : route.domain, remoteTokenMessengers: circleWord(CIRCLE_MESSENGER), localMinter: CIRCLE_MINTER, localMessageTransmitter: CIRCLE_TRANSMITTER,
      localTokenMessenger: CIRCLE_MESSENGER, version: 1, messageBodyVersion: 1, decimals: 6, paused: false, signatureThreshold: 2n, getNumEnabledAttesters: 2n,
      getEnabledAttester: decoded.functionName === "getEnabledAttester" ? getAddress(`0x${String(Number(decoded.args![0]) + 1).repeat(40)}`) : null,
      remoteTokensToLocalTokens: source ? CIRCLE_SOURCE_TOKEN : route.token } as Record<string, unknown>)[decoded.functionName];
    return encodeFunctionResult({ abi: CIRCLE_RPC_ABI, functionName: decoded.functionName as never, result: value as never });
  };
  return { posts, https: { request: async (_url: string, _method: string, body: string | null) => {
    const parsed = JSON.parse(body!) as Call | Call[], calls = Array.isArray(parsed) ? parsed : [parsed]; posts.push(calls);
    const rows = calls.map(q => ({ jsonrpc: "2.0", id: q.id, result: answer(q) }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? rows : rows[0]) };
  } } };
}
const lean = (chainId: number, https: ReturnType<typeof transport>["https"]) => new CircleRpc(`https://lean-${chainId}.example`, chainId, https, CIRCLE_COMMAND_REQUEST_BUDGET);

test("lean client checks the chain once and batches concurrent reads into one POST", async () => {
  const t = transport(42161), rpc = lean(42161, t.https);
  await rpc.identity(); await rpc.identity();
  const [a, b, c] = await Promise.all([rpc.block("latest"), rpc.call("eth_getBlockByNumber", ["safe", false]), rpc.read(CIRCLE_SOURCE_TOKEN, "decimals")]);
  assert.equal((a as { hash: string }).hash, blockHash); assert.equal((b as { hash: string }).hash, blockHash); assert.equal(c, 6);
  assert.deepEqual(t.posts.map(p => p.map(q => q.method)), [["eth_chainId"], ["eth_getBlockByNumber", "eth_getBlockByNumber", "eth_call"]]);
  assert.equal(rpc.requestCount, 4); assert.equal(rpc.postCount, 2);
});

test("lean observation is two POSTs and four calls with no header sandwich", async () => {
  const t = transport(42161), rpc = lean(42161, t.https); await rpc.identity(); t.posts.length = 0;
  const observed = await rpc.observation(hash, "finalized");
  assert.ok(observed !== null); assert.equal(observed.recheckedBlock, observed.canonicalBlock);
  assert.deepEqual(t.posts.map(p => p.map(q => q.method)), [["eth_getTransactionByHash", "eth_getTransactionReceipt"], ["eth_getBlockByNumber", "eth_getBlockByNumber"]]);
  assert.deepEqual(t.posts[1]!.map(q => q.params[0]), ["finalized", "0xa"]);
});

test("live configuration is one POST of functional reads at the latest head, without implementation or code pins", async () => {
  for (const chainId of [42161, 143]) {
    const t = transport(chainId), rpc = lean(chainId, t.https); await rpc.identity(); t.posts.length = 0;
    const snapshot = await readCircleDeployment(rpc, 143);
    assert.equal(t.posts.length, 1); assert.equal(t.posts[0]!.length, 13);
    assert.ok(t.posts[0]!.every(q => q.method === "eth_call" ? q.params[1] === "latest" : q.method === "eth_getBlockByNumber" && q.params[0] === "latest"));
    assert.equal(snapshot.contracts, undefined); assert.equal(snapshot.pairedToken, chainId === 42161 ? CIRCLE_SOURCE_TOKEN : circleRoute(143).token);
  }
  const s = transport(42161), d = transport(143);
  const digest = verifyCircleDeployments(await readCircleDeployment(lean(42161, s.https), 143), await readCircleDeployment(lean(143, d.https), 143));
  assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.equal(circleTokenPairKey(3, CIRCLE_SOURCE_TOKEN).length, 66);
});

test("live attester set is two POSTs at the latest head", async () => {
  const t = transport(143), rpc = lean(143, t.https); await rpc.identity(); t.posts.length = 0;
  const snapshot = await readCircleAttesters(rpc, "a".repeat(64));
  assert.equal(snapshot.threshold, 2); assert.equal(snapshot.enabledAttesters.length, 2);
  assert.deepEqual(t.posts.map(p => p.length), [3, 2]);
});

test("a failed batch entry rejects only its own read and the budget is derived from the read plan", async () => {
  const posts: unknown[] = [];
  const rpc = lean(42161, { request: async (_url: string, _method: string, body: string | null) => {
    const calls = JSON.parse(body!) as Call[]; posts.push(calls);
    return { status: 200, body: JSON.stringify(calls.map(q => q.method === "eth_getBalance" ? { jsonrpc: "2.0", id: q.id, error: { code: -32000 } } : { jsonrpc: "2.0", id: q.id, result: "0x1" })) };
  } });
  const [ok, failed] = await Promise.allSettled([rpc.call("eth_getTransactionCount", ["0x0", "latest"]), rpc.call("eth_getBalance", ["0x0", "latest"])]);
  assert.equal(ok.status, "fulfilled"); assert.equal(failed.status, "rejected"); assert.equal(posts.length, 1);
  assert.ok(CIRCLE_COMMAND_REQUEST_BUDGET >= 2 * (1 + 13 + 23 + 3 * 8 + 8 * 4));
});

/** PublicNode's keyless Arbitrum root on 2026-11-10 refused every eth_getTransactionReceipt, recent or not: HTTP 403 with
 * this body for a lone call, HTTP 200 with this error row inside a batch (QA saw "Circle RPC result envelope is invalid"). */
const PUBLICNODE_REFUSAL = { code: -32602, message: "Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode" };
const SWITCH_ARBITRUM = ["Set APN_ARBITRUM_RPC_URL to a public HTTPS RPC endpoint of that chain, then rerun the same command."];
function answering(row: (q: Call) => Record<string, unknown>, status = 200) {
  const posts: Call[][] = [];
  return { posts, https: { request: async (_url: string, _method: string, body: string | null) => {
    const parsed = JSON.parse(body!) as Call | Call[], calls = Array.isArray(parsed) ? parsed : [parsed]; posts.push(calls);
    const rows = calls.map(q => ({ jsonrpc: "2.0", id: q.id, ...row(q) }));
    return { status, body: JSON.stringify(Array.isArray(parsed) ? rows : rows[0]) };
  } } };
}
async function refused(work: Promise<unknown>): Promise<ApnError> {
  const outcome = await work.then(() => null, (error: unknown) => error);
  assert.ok(outcome instanceof ApnError, "expected an APN refusal"); return outcome;
}
const envelope = (error: ApnError) => failureEnvelope("circle.evm.observe", "request", error).next_actions;

test("an HTTP refusal names its status and the chain's RPC setting; HTTP 429 is a rate limit, retried once", async () => {
  const forbidden = answering(() => ({ error: PUBLICNODE_REFUSAL }), 403);
  const e = await refused(lean(42161, forbidden.https).call("eth_getTransactionReceipt", [hash]));
  assert.deepEqual([e.code, e.details?.httpStatus, e.details?.reason, forbidden.posts.length], ["APN_RPC_CONFIG", 403, "rpc_status", 1]);
  assert.match(e.message, /HTTP 403 to eth_getTransactionReceipt; set APN_ARBITRUM_RPC_URL to another public HTTPS RPC endpoint/u);
  assert.deepEqual(envelope(e), SWITCH_ARBITRUM);
  assert.match((await refused(lean(143, answering(() => ({ result: "0x8f" }), 502).https).call("eth_chainId", []))).message, /HTTP 502 to eth_chainId; set APN_MONAD_RPC_URL /u);
  const limited = answering(() => ({ result: "0x1" }), 429), l = await refused(lean(42161, limited.https).call("eth_getTransactionReceipt", [hash]));
  assert.deepEqual([l.code, l.details?.httpStatus, l.details?.retryable, limited.posts.length], ["APN_RPC_RATE_LIMITED", 429, true, 2]);
  assert.deepEqual(envelope(l), ["Wait for the RPC provider's rate-limit window, then rerun the same command; prepared operations are idempotent."]);
});

test("PublicNode's receipt refusal inside a batch (HTTP 200) is the endpoint's refusal, not an invalid envelope; a broken envelope still is", async () => {
  const t = answering(q => q.method === "eth_chainId" ? { result: "0xa4b1" } : q.method === "eth_getTransactionReceipt" ? { error: PUBLICNODE_REFUSAL } : { result: null });
  const e = await refused(lean(42161, t.https).observation(hash, "included"));
  assert.deepEqual(t.posts.map(p => p.map(q => q.method)), [["eth_chainId"], ["eth_getTransactionByHash", "eth_getTransactionReceipt"]]);
  assert.deepEqual([e.code, e.details?.reason, e.details?.rpcErrorCode, e.details?.httpStatus], ["APN_RPC_CONFIG", "rpc_error", -32602, undefined]);
  assert.match(e.message, /refused eth_getTransactionReceipt with JSON-RPC error -32602; set APN_ARBITRUM_RPC_URL /u);
  assert.deepEqual(envelope(e), SWITCH_ARBITRUM);
  const single = (method: string, row: Record<string, unknown>) => refused(lean(42161, answering(() => row).https).call(method, [{ to: CIRCLE_SOURCE_TOKEN }, "latest"]));
  const limited = await single("eth_getBalance", { error: { code: -32005, message: "limit exceeded" } });
  assert.deepEqual([limited.code, limited.details?.reason, limited.details?.retryable], ["APN_RPC_RATE_LIMITED", "json_rpc_rate_limit", true]);
  // A revert is the chain's answer: it stays a protocol refusal and names no setting to change.
  const reverted = await single("eth_call", { error: { code: 3, message: "execution reverted", data: "0x" } });
  assert.deepEqual([reverted.code, reverted.details?.reason, envelope(reverted)], ["APN_RPC_PROTOCOL", "rpc_execution_reverted", []]);
  for (const row of [{ error: { code: -32000 } }, { result: "0x1", error: PUBLICNODE_REFUSAL }, { error: "refused" }]) {
    const broken = await single("eth_getBalance", row);
    assert.deepEqual([broken.code, broken.message], ["APN_RPC_PROTOCOL", "Circle RPC result envelope is invalid."]);
  }
});

test("the external-mint proof reader names the same refusals and the chain's RPC setting", async () => {
  const forbidden = answering(() => ({ error: PUBLICNODE_REFUSAL }), 403);
  const source = new CircleExternalRpc("https://arbitrum-one-rpc.publicnode.com", 42161, new CircleExternalRpcBudget(() => 1, 100, forbidden.https));
  const e = await refused(source.call("eth_getTransactionReceipt", [hash]));
  assert.deepEqual([e.code, e.details?.httpStatus, e.details?.origin], ["APN_RPC_CONFIG", 403, "https://arbitrum-one-rpc.publicnode.com"]);
  assert.deepEqual(envelope(e), SWITCH_ARBITRUM);
  const destination = new CircleExternalRpc("https://rpc.example", 143, new CircleExternalRpcBudget(() => 1, 100, answering(() => ({ error: PUBLICNODE_REFUSAL })).https));
  const d = await refused(destination.call("eth_getTransactionReceipt", [hash]));
  assert.deepEqual([d.code, d.details?.reason, d.details?.rpcErrorCode], ["APN_RPC_CONFIG", "rpc_error", -32602]);
  assert.match(d.message, /set APN_MONAD_RPC_URL /u);
});
