/** Phase-2 public-RPC diet of the live Circle rails: physical POST and call counts from a mock JSON-RPC transport. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult, getAddress, type Hex } from "viem";
import { CIRCLE_MESSENGER, CIRCLE_MINTER, CIRCLE_SOURCE_TOKEN, CIRCLE_TRANSMITTER, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { circleTokenPairKey, verifyCircleDeployments } from "../../src/circle-v2-evm/preflight.js";
import { circleWord } from "../../src/circle-v2-evm/protocol.js";
import { CIRCLE_COMMAND_REQUEST_BUDGET, CIRCLE_RPC_ABI, CircleRpc, readCircleAttesters, readCircleDeployment } from "../../src/circle-v2-evm/rpc.js";

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
const lean = (chainId: number, https: ReturnType<typeof transport>["https"]) => new CircleRpc(`https://lean-${chainId}.example`, chainId, https, CIRCLE_COMMAND_REQUEST_BUDGET, "0", undefined, "lean");

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
