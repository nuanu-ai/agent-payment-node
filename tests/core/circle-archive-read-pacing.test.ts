import assert from "node:assert/strict";
import test from "node:test";
import { CircleArchiveReadPacer, archiveReadInterval } from "../../src/circle-archive-read-pacing.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import { Cleanup85NativeRpc } from "../../src/circle-cleanup85-native-rpc.js";
import { keccak256 } from "viem";
import { ApnError } from "../../src/errors.js";
import { withCleanup85NativeAuthority } from "../../src/circle-cleanup85-native-authority.js";
const endpoint = "https://arbitrum-one-public.nodies.app";
function fixture() {
  let clock = 0; const starts: Array<{ at: number; method: string }> = [];
  const pacer = new CircleArchiveReadPacer(() => clock, async ms => { clock += ms; });
  const transport = { request: async (_url: string, _method: "GET" | "POST", body: string | null) => {
    const r = JSON.parse(body!); starts.push({ at: clock, method: r.method });
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: r.id, result: "0xa4b1" }) };
  } };
  return { pacer, transport, starts, now: () => clock };
}
test("archive pacing accepts only bounded canonical config before any transport", () => {
  for (const raw of [undefined, "0", "1", "300", "500"]) assert.equal(archiveReadInterval(raw), Number(raw ?? 0));
  for (const raw of ["", "00", "0300", "501", "-1", "1.5", " 300", "Infinity", "1e2"]) {
    assert.throws(() => new CircleRpc(endpoint, 42161, undefined, 192, raw), e => e instanceof ApnError && e.code === "APN_RPC_CONFIG");
    assert.throws(() => new Cleanup85NativeRpc(endpoint, undefined, 224, Date.now, raw), e => e instanceof ApnError && e.code === "APN_RPC_CONFIG");
  }
});
test("concurrent Circle and native instances share read starts while responses remain concurrent", async () => {
  const f = fixture(), circle = new CircleRpc(endpoint, 42161, f.transport, 192, "300", f.pacer), native = new Cleanup85NativeRpc(endpoint, f.transport, 224, Date.now, "300", f.pacer);
  await Promise.all([circle.call("eth_chainId", []), native.call("eth_getTransactionCount", []), circle.call("eth_call", [])]);
  assert.deepEqual(f.starts.map(r => r.at), [0, 300, 600]); assert.equal(native.physicalRequestCount, 1);
});
test("default zero and official Arbitrum/Sei requests add no waits", async () => {
  const f = fixture();
  await Promise.all([new CircleRpc(endpoint, 42161, f.transport, 192, "0", f.pacer).identity(),
    new CircleRpc("https://arb1.arbitrum.io/rpc", 42161, f.transport, 192, "300", f.pacer).identity(),
    new Cleanup85NativeRpc("https://rpc.sei-apis.com", f.transport, 224, Date.now, "300", f.pacer).call("eth_chainId", [])]);
  assert.deepEqual(f.starts.map(r => r.at), [0, 0, 0]);
});
test("broadcast and unsupported methods never enter read scheduling", async () => {
  const f = fixture();
  await f.pacer.start(endpoint, "eth_chainId", 300, () => {}, async () => {});
  for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "eth_sign", "wallet_sendCalls", "not_a_read"]) {
    await f.pacer.start(endpoint, method, 300, () => { throw Error("pacing forbidden"); }, async () => {});
  }
  assert.equal(f.now(), 0);
  const circle = new CircleRpc(endpoint, 42161, { request: async () => { throw new ApnError("APN_RPC_CONFIG", "transport"); } }, 192, "300", f.pacer);
  await assert.rejects(circle.call("eth_sendRawTransaction", ["not-printed"], () => {})); assert.equal(f.now(), 0);
  await assert.rejects(new Cleanup85NativeRpc(endpoint, f.transport, 224, Date.now, "300", f.pacer).call("eth_sendRawTransaction", ["0x0200"], () => {})); assert.equal(f.starts.length, 0);
});
test("transient read retains exactly one retry and each request consumes original budget", async () => {
  const f = fixture(); let posts = 0;
  const transport = { request: async (...args: Parameters<typeof f.transport.request>) => { posts++; const result = await f.transport.request(...args); return posts === 1 ? { status: 429, body: "" } : result; } };
  const circle = new CircleRpc(endpoint, 42161, transport, 2, "300", f.pacer);
  await circle.identity(); assert.equal(posts, 2); assert.deepEqual(f.starts.map(r => r.at), [0, 300]);
  await assert.rejects(circle.identity(), /rpc_method_or_budget/); assert.equal(posts, 2);
  const native = new Cleanup85NativeRpc(endpoint, { request: async () => { posts++; return { status: 429, body: "" }; } }, 1, Date.now, "300", f.pacer);
  await assert.rejects(native.call("eth_chainId", [])); await assert.rejects(native.call("eth_chainId", []), /rpc_method_or_physical_budget/); assert.equal(posts, 3);
});
test("queued guard and abort refuse dispatch and a rejected queue remains usable", async () => {
  const f = fixture(); await f.pacer.start(endpoint, "eth_chainId", 300, () => {}, async () => {});
  let posts = 0; const abort = new AbortController();
  await assert.rejects(f.pacer.start(endpoint, "eth_call", 300, () => { if (f.now() >= 50) abort.abort(); }, async () => { posts++; }, abort.signal));
  assert.equal(posts, 0); assert.equal(f.now(), 50);
  await f.pacer.start(endpoint, "eth_chainId", 300, () => {}, async () => { posts++; }); assert.equal(posts, 1); assert.equal(f.now(), 300);
});
test("pacing crosses original foreground expiry without resetting it or opening custody", async () => {
  const f = fixture(); let custody = 0;
  await withCleanup85NativeAuthority("binding", new Date(60000).toISOString(), f.now, async () => {}, async authority => {
    await f.pacer.start(endpoint, "eth_chainId", 300, () => authority.assert("binding", new Date(60000).toISOString()), async () => {});
    for (let i = 0; i < 199; i++) await f.pacer.start(endpoint, "eth_chainId", 300, () => authority.assert("binding", new Date(60000).toISOString()), async () => {});
    await assert.rejects(f.pacer.start(endpoint, "eth_chainId", 300, () => authority.assert("binding", new Date(60000).toISOString()), async () => { custody++; }), /expired/);
  });
  assert.equal(f.now(), 60000); assert.equal(custody, 0);
});

test("default production queue is shared across client types", async () => {
  const starts: number[] = [];
  const transport = { request: async (_url: string, _method: "GET" | "POST", body: string | null) => {
    starts.push(performance.now()); const r = JSON.parse(body!);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: r.id, result: "0xa4b1" }) };
  } };
  await Promise.all([new CircleRpc(endpoint, 42161, transport, 192, "30").identity(), new Cleanup85NativeRpc(endpoint, transport, 224, Date.now, "30").call("eth_chainId", [])]);
  assert.ok(starts[1]! - starts[0]! >= 29);
});

test("enabled pacing keeps broadcast single-attempt and native physical guard at its existing two gates", async () => {
  const f = fixture(); await f.pacer.start(endpoint, "eth_chainId", 300, () => {}, async () => {});
  let circlePosts = 0, nativePosts = 0, checks = 0;
  const circle = new CircleRpc(endpoint, 42161, { request: async () => { circlePosts++; return { status: 503, body: "" }; } }, 192, "300", f.pacer);
  await assert.rejects(circle.call("eth_sendRawTransaction", ["not-printed"], () => {})); assert.equal(circlePosts, 1);
  const raw = "0x0200";
  await withCleanup85NativeAuthority("binding", new Date(100000).toISOString(), f.now, async () => {}, async authority => {
    const physical = authority.beforeSend("binding", raw, keccak256(raw), () => { checks++; });
    const native = new Cleanup85NativeRpc(endpoint, { request: async (_url, _method, body, _max, _code, beforeSend) => {
      await beforeSend?.(); await beforeSend?.(); nativePosts++; const r = JSON.parse(body!);
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: r.id, result: "0x" }) };
    } }, 224, Date.now, "300", f.pacer);
    await native.call("eth_sendRawTransaction", [raw], physical);
  });
  assert.equal(nativePosts, 1); assert.equal(checks, 2); assert.equal(f.now(), 0);
});
