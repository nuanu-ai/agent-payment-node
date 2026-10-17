/**
 * SYNTHETIC and RECORDED: discovery of the destination transaction that consumed a CCTP V2 issuer message, from block
 * headers and MessageTransmitter logs only. Synthetic chains check the bounded locate, the per-route log windows and the
 * request cap; two recorded public transcripts (Linea and Monad, 2026-10-17) replay the real response shapes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeEventTopics, keccak256, toHex, type Hex } from "viem";
import { canonicalJson } from "../../src/canonical.js";
import { CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "../../src/circle-v2-evm/catalog.js";
import { CIRCLE_ABI } from "../../src/circle-v2-evm/protocol.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import { CIRCLE_DISCOVERY_CLOCK_MARGIN_S, CIRCLE_DISCOVERY_READ_PLAN, CIRCLE_DISCOVERY_REQUEST_BUDGET, discoverCircleExternalMint } from "../../src/circle-v2-evm/external-discovery.js";

const TOPIC = encodeEventTopics({ abi: CIRCLE_ABI, eventName: "MessageReceived" })[0], NONCE = keccak256(toHex("synthetic-nonce")), MINT = keccak256(toHex("synthetic-mint"));
const q = (n: bigint) => `0x${n.toString(16)}`;
/** A synthetic destination: `time(n)` stamps block n; one MessageReceived log for NONCE sits in `mintBlock`. */
function chain(chainId: CircleDestinationChain, head: bigint, time: (n: bigint) => bigint, mintBlock: bigint | null, extra: (log: Record<string, unknown>) => Record<string, unknown>[] = l => [l]) {
  const methods: string[] = [], windows: { from: bigint; to: bigint }[] = [];
  const log = { address: CIRCLE_TRANSMITTER.toLowerCase(), topics: [TOPIC, `0x${"00".repeat(12)}${"99".repeat(20)}`, NONCE, q(1000n).replace("0x", "0x" + "0".repeat(61))], data: "0x",
    blockNumber: q(mintBlock ?? 0n), transactionHash: MINT, logIndex: "0x0", removed: false };
  const answer = (r: { id: unknown; method: string; params: any[] }) => {
    methods.push(r.method); let result: unknown;
    if (r.method === "eth_chainId") result = q(BigInt(chainId));
    else if (r.method === "eth_getBlockByNumber") { const n = r.params[0] === "latest" ? head : BigInt(r.params[0]); assert.ok(n >= 0n && n <= head); result = { number: q(n), timestamp: q(time(n)), hash: keccak256(toHex(`b${n}`)) }; }
    else if (r.method === "eth_getLogs") {
      const f = r.params[0], from = BigInt(f.fromBlock), to = BigInt(f.toBlock); windows.push({ from, to });
      assert.equal(f.address, CIRCLE_TRANSMITTER); assert.deepEqual(f.topics, [TOPIC, null, NONCE]); assert.ok(to - from + 1n <= BigInt(circleRoute(chainId).logRange), "window wider than the route allows");
      result = mintBlock !== null && mintBlock >= from && mintBlock <= to ? extra(log) : [];
    } else throw new Error(`state or unexpected read ${r.method}`);
    return { jsonrpc: "2.0", id: r.id, result };
  };
  const transport = { request: async (_url: string, _method: string, body: string | null) => { const x = JSON.parse(body!); return { status: 200, body: JSON.stringify(Array.isArray(x) ? x.map(answer) : answer(x)) }; } };
  return { rpc: new CircleRpc("https://destination.example", chainId, transport as never, CIRCLE_DISCOVERY_REQUEST_BUDGET, "lean"), methods, windows };
}

test("the discovery budget is derived from its read plan with one retry per read", () => {
  const p = CIRCLE_DISCOVERY_READ_PLAN; assert.equal(CIRCLE_DISCOVERY_REQUEST_BUDGET, 2 * (p.identity + p.head + p.locate + p.logs));
  assert.deepEqual(([1329, 59144, 143] as const).map(c => circleRoute(c).logRange), [2000, 10000, 100]);
});

test("Monad: from the block stamped at the burn time less the clock margin, contiguous 100-block windows up to the one holding the mint", async () => {
  // One block per second; the burn is stamped at block 10010's time, the mint sits 440 blocks later.
  const c = chain(143, 20_000n, n => 1_899_990_000n + n, 10_450n), burn = 1_899_990_000n + 10_010n;
  const scan = await discoverCircleExternalMint(c.rpc, NONCE, burn);
  assert.equal(scan.transactionHash, MINT); assert.equal(scan.fromBlock, 10_010n - CIRCLE_DISCOVERY_CLOCK_MARGIN_S); assert.equal(scan.logReads, 6);
  assert.deepEqual(c.windows.map(w => [w.from, w.to]), [0, 1, 2, 3, 4, 5].map(i => [9_950n + 100n * BigInt(i), 10_049n + 100n * BigInt(i)]));
  assert.ok(scan.headerReads <= 1 + CIRCLE_DISCOVERY_READ_PLAN.locate); assert.ok(scan.headerReads <= 6, `${scan.headerReads} header reads`);
  assert.deepEqual([...new Set(c.methods)].sort(), ["eth_chainId", "eth_getBlockByNumber", "eth_getLogs"]); assert.equal(c.rpc.requestCount, c.methods.length);
});

test("Linea: irregular block times still locate the start within one 10000-block window and find a mint an hour after the burn", async () => {
  // Blocks every 2 to 12 seconds; block n is stamped at the running sum.
  const stamps: bigint[] = [1_700_000_000n]; for (let n = 1; n <= 300_000; n++) stamps.push(stamps[n - 1]! + BigInt(2 + (n * 7919) % 11));
  const time = (n: bigint) => stamps[Number(n)]!, burnBlock = 120_000n, mint = burnBlock + 500n, c = chain(59144, 300_000n, time, mint);
  const scan = await discoverCircleExternalMint(c.rpc, NONCE, time(burnBlock));
  assert.equal(scan.transactionHash, MINT); assert.equal(scan.logReads, 1); assert.ok(time(scan.fromBlock) <= time(burnBlock) - CIRCLE_DISCOVERY_CLOCK_MARGIN_S);
  assert.ok(burnBlock - scan.fromBlock <= 10_000n + 60n, `start ${scan.fromBlock}`); assert.ok(scan.headerReads <= 1 + CIRCLE_DISCOVERY_READ_PLAN.locate);
});

test("Sei: the last window stops at the latest head; a burn newer than the head scans only the head", async () => {
  const c = chain(1329, 5_000n, n => 1_000_000n + n, null), scan = await discoverCircleExternalMint(c.rpc, NONCE, 1_000_000n + 2_000n);
  assert.equal(scan.transactionHash, null); assert.deepEqual(c.windows.map(w => [w.from, w.to]), [[1_940n, 3_939n], [3_940n, 5_000n]]); assert.equal(scan.toBlock, 5_000n);
  const later = chain(1329, 5_000n, n => 1_000_000n + n, null), ahead = await discoverCircleExternalMint(later.rpc, NONCE, 1_000_000n + 9_000n);
  assert.deepEqual(later.windows.map(w => [w.from, w.to]), [[5_000n, 5_000n]]); assert.equal(ahead.headerReads, 1);
});

test("not found within the cap: exactly the plan's log windows, then a null result", async () => {
  const c = chain(143, 50_000n, n => 1_899_990_000n + n, 49_000n), scan = await discoverCircleExternalMint(c.rpc, NONCE, 1_899_990_000n + 10_010n);
  assert.equal(scan.transactionHash, null); assert.equal(scan.logReads, CIRCLE_DISCOVERY_READ_PLAN.logs); assert.equal(c.windows.length, CIRCLE_DISCOVERY_READ_PLAN.logs);
  assert.equal(scan.toBlock, 9_950n + 100n * BigInt(CIRCLE_DISCOVERY_READ_PLAN.logs) - 1n); assert.ok(c.rpc.requestCount <= CIRCLE_DISCOVERY_REQUEST_BUDGET);
});

for (const [name, extra, reason] of [
  ["two logs for one nonce", (l: Record<string, unknown>) => [l, { ...l, transactionHash: keccak256(toHex("other")) }], /discovery_nonce_consumed_twice/],
  ["a log from another emitter", (l: Record<string, unknown>) => [{ ...l, address: `0x${"12".repeat(20)}` }], /discovery_log_filter/],
  ["a log for another nonce", (l: Record<string, unknown>) => [{ ...l, topics: [TOPIC, (l.topics as string[])[1], keccak256(toHex("x")), (l.topics as string[])[3]] }], /discovery_log_filter/],
  ["a log outside the window", (l: Record<string, unknown>) => [{ ...l, blockNumber: "0x1" }], /discovery_log_window/],
] as const) test(`an untrusted log response fails closed: ${name}`, async () => {
  const c = chain(143, 20_000n, n => 1_899_990_000n + n, 10_015n, extra as never);
  await assert.rejects(discoverCircleExternalMint(c.rpc, NONCE, 1_899_990_000n + 10_010n), reason);
});
test("a removed (reorged) log is not a consumer", async () => {
  const c = chain(143, 20_000n, n => 1_899_990_000n + n, 10_015n, l => [{ ...l, removed: true }]);
  assert.equal((await discoverCircleExternalMint(c.rpc, NONCE, 1_899_990_000n + 10_010n)).transactionHash, null);
});

/** Public transcripts recorded by the read-only live proof: every request the discovery made and the answer it got. */
interface Transcript { readonly chainId: CircleDestinationChain; readonly nonce: Hex; readonly burnTimestamp: string; readonly transactionHash: Hex; readonly exchanges: readonly { readonly method: string; readonly params: unknown[]; readonly result: unknown }[]; }
for (const name of ["linea-op-a", "monad-op-b"] as const) test(`recorded public shapes (${name}) replay to the exact external mint`, async () => {
  const t = JSON.parse(await readFile(join(process.cwd(), `tests/fixtures/circle-external/discovery-${name}.json`), "utf8")) as Transcript;
  let index = 0;
  const answer = (r: { id: unknown; method: string; params: unknown[] }) => {
    const e = t.exchanges[index++]; assert.ok(e !== undefined, "more requests than recorded");
    assert.equal(canonicalJson({ method: r.method, params: r.params }), canonicalJson({ method: e.method, params: e.params })); return { jsonrpc: "2.0", id: r.id, result: e.result };
  };
  const transport = { request: async (_url: string, _method: string, body: string | null) => { const x = JSON.parse(body!); return { status: 200, body: JSON.stringify(Array.isArray(x) ? x.map(answer) : answer(x)) }; } };
  const rpc = new CircleRpc(circleRoute(t.chainId).rpcDefault, t.chainId, transport as never, CIRCLE_DISCOVERY_REQUEST_BUDGET, "lean");
  const scan = await discoverCircleExternalMint(rpc, t.nonce, BigInt(t.burnTimestamp));
  assert.equal(scan.transactionHash, t.transactionHash); assert.equal(index, t.exchanges.length); assert.equal(rpc.requestCount, t.exchanges.length);
  assert.ok(t.exchanges.every(e => ["eth_chainId", "eth_getBlockByNumber", "eth_getLogs"].includes(e.method)));
});
