import assert from "node:assert/strict";
import test from "node:test";
import { bridgeRpcCall, RpcReadSession } from "../../src/lifi/rpc.js";
import { ApnError } from "../../src/errors.js";
import { bridgeArchiveEndpoint, isArchiveRead, isHistoricalStateRead } from "../../src/lifi/rpc-archive.js";

function fixture(chainIds: Readonly<Record<string, string>> = {}) {
  const calls: Array<{ host: string; method: string }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as { id: string; method: string };
    const host = new URL(endpoint).host;
    calls.push({ host, method: request.method });
    const result = request.method === "eth_chainId" ? (chainIds[host] ?? "0x1") : "0x60";
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  } };
  return { transport, calls };
}
const primary = { APN_ETHEREUM_RPC_URL: "https://primary.example" };
const withArchive = { ...primary, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" };
const DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";

test("block-pinned state and exact-hash receipt reads go to the owner-named archive after one chain check", async () => {
  const f = fixture();
  const rpc = bridgeRpcCall(1, withArchive, { transport: f.transport });
  assert.equal(rpc.origin, "https://primary.example");
  await rpc.call("eth_getCode", [DIAMOND, "0x18c9a42"]);
  await rpc.call("eth_call", [{ to: DIAMOND, data: "0x" }, { blockHash: `0x${"a".repeat(64)}`, requireCanonical: true }]);
  await rpc.call("eth_getStorageAt", [DIAMOND, "0x0", "0x18c9a42"]);
  await rpc.call("eth_getCode", [DIAMOND, "latest"]);
  await rpc.call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]);
  assert.deepEqual(f.calls, [
    { host: "archive.example", method: "eth_chainId" },
    { host: "archive.example", method: "eth_getCode" },
    { host: "archive.example", method: "eth_call" },
    { host: "archive.example", method: "eth_getStorageAt" },
    { host: "primary.example", method: "eth_getCode" },
    { host: "archive.example", method: "eth_getTransactionReceipt" },
  ]);
});

test("without an archive name every read stays on the bound RPC", async () => {
  const f = fixture();
  await bridgeRpcCall(1, primary, { transport: f.transport }).call("eth_getCode", [DIAMOND, "0x18c9a42"]);
  await bridgeRpcCall(1, primary, { transport: f.transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]);
  assert.deepEqual(f.calls, [
    { host: "primary.example", method: "eth_getCode" },
    { host: "primary.example", method: "eth_getTransactionReceipt" },
  ]);
});

test("concurrent block-pinned reads share one archive chain check", async () => {
  const f = fixture();
  const rpc = bridgeRpcCall(1, withArchive, { transport: f.transport });
  await Promise.all([
    rpc.call("eth_getCode", [DIAMOND, "0x18c9a42"]),
    rpc.call("eth_getStorageAt", [DIAMOND, "0x0", "0x18c9a42"]),
  ]);
  assert.deepEqual(f.calls, [
    { host: "archive.example", method: "eth_chainId" },
    { host: "archive.example", method: "eth_getCode" },
    { host: "archive.example", method: "eth_getStorageAt" },
  ]);
});

test("session-bound RPC preserves archive routing while counting archive reads", async () => {
  const f = fixture();
  const descriptor = bridgeRpcCall(1, withArchive, { transport: f.transport });
  const session = new RpcReadSession({ wait: async () => {} }), call = descriptor.sessionCall(session);
  await call("eth_getCode", [DIAMOND, "0x18c9a42"]);
  await call("eth_getCode", [DIAMOND, "latest"]);
  await call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]);
  assert.deepEqual(f.calls, [
    { host: "archive.example", method: "eth_chainId" },
    { host: "archive.example", method: "eth_getCode" },
    { host: "primary.example", method: "eth_getCode" },
    { host: "archive.example", method: "eth_getTransactionReceipt" },
  ]);
  assert.deepEqual(session.telemetry().perMethod, { eth_chainId: 1, eth_getCode: 2, eth_getTransactionReceipt: 1 });
  assert.equal(session.telemetry().logicalItems, 4);
});

test("an archive reader on another chain is refused before any historical read", async () => {
  const f = fixture({ "archive.example": "0x2105" });
  await assert.rejects(bridgeRpcCall(1, withArchive, { transport: f.transport }).call("eth_getCode", [DIAMOND, "0x18c9a42"]),
    { code: "APN_RPC_CONFIG", message: /bridge_archive_RPC_chain/u });
  assert.deepEqual(f.calls, [{ host: "archive.example", method: "eth_chainId" }]);
});

test("an archive receipt reader on another chain is refused before the receipt read", async () => {
  const f = fixture({ "archive.example": "0x2105" });
  await assert.rejects(bridgeRpcCall(1, withArchive, { transport: f.transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]),
    { code: "APN_RPC_CONFIG", message: /bridge_archive_RPC_chain/u });
  assert.deepEqual(f.calls, [{ host: "archive.example", method: "eth_chainId" }]);
});

test("session-bound archive chain checks do not reuse the primary chain identity", async () => {
  const f = fixture({ "archive.example": "0x2105" });
  const descriptor = bridgeRpcCall(1, withArchive, { transport: f.transport });
  const call = descriptor.sessionCall(new RpcReadSession({ wait: async () => {} }));
  await assert.rejects(call("eth_getCode", [DIAMOND, "0x18c9a42"]),
    { code: "APN_RPC_CONFIG", message: /bridge_archive_RPC_chain/u });
  assert.deepEqual(f.calls, [{ host: "archive.example", method: "eth_chainId" }]);
});

test("one deployment batch routes every numeric read and its chain identity to the archive", async () => {
  const calls: Array<{ host: string; methods: string[] }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as Array<{ id: string; method: string }>;
    calls.push({ host: new URL(endpoint).host, methods: request.map((item) => item.method) });
    return { status: 200, body: JSON.stringify(request.map((item) => ({ jsonrpc: "2.0", id: item.id,
      result: item.method === "eth_chainId" ? "0x1" : item.method === "eth_getBlockByNumber"
        ? { number: "0x10", hash: `0x${"1".repeat(64)}`, timestamp: "0x20" } : "0x60" }))) };
  } };
  const descriptor = bridgeRpcCall(1, withArchive, { transport });
  const batch = descriptor.sessionBatchCall(new RpcReadSession({ wait: async () => {} }));
  const decodeChain = (value: unknown) => {
    if (value !== "0x1") throw new ApnError("APN_CHAIN_MISMATCH", "wrong archive chain");
    return value;
  };
  await batch([
    { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: decodeChain },
    { method: "eth_getCode", params: [DIAMOND, "0x10"], cachePolicy: "immutable", decoder: String },
    { method: "eth_getStorageAt", params: [DIAMOND, "0x0", "0x10"], cachePolicy: "immutable", decoder: String },
    { method: "eth_getBlockByNumber", params: ["0x10", false], cachePolicy: "immutable", decoder: Object },
  ], "archive");
  assert.deepEqual(calls, [{ host: "archive.example", methods: ["eth_chainId", "eth_getCode", "eth_getStorageAt", "eth_getBlockByNumber"] }]);
});

test("wrong archive chain aborts the whole batch without caching any deployment item", async () => {
  let wrong = true; const bodies: string[] = [];
  const transport = { request: async (_endpoint: string, _verb: string, body: string | null) => {
    bodies.push(body!); const request = JSON.parse(body!) as Array<{ id: string; method: string }>;
    return { status: 200, body: JSON.stringify(request.map((item) => ({ jsonrpc: "2.0", id: item.id,
      result: item.method === "eth_chainId" ? (wrong ? "0x2105" : "0x1") : "0x60" }))) };
  } };
  const session = new RpcReadSession({ wait: async () => {} });
  const batch = bridgeRpcCall(1, withArchive, { transport }).sessionBatchCall(session);
  const items = [
    { method: "eth_chainId", params: [], cachePolicy: "immutable" as const, decoder: (value: unknown) => {
      if (value !== "0x1") throw new ApnError("APN_CHAIN_MISMATCH", "wrong archive chain");
      return value;
    } },
    { method: "eth_getCode", params: [DIAMOND, "0x10"], cachePolicy: "immutable" as const, decoder: String },
  ];
  await assert.rejects(batch(items, "archive"), { code: "APN_CHAIN_MISMATCH" });
  wrong = false; await batch(items, "archive");
  assert.equal(bodies.length, 2);
  assert.equal((JSON.parse(bodies[1]!) as unknown[]).length, 2);
  assert.equal(session.telemetry().cacheHits, 0);
});

test("archive endpoints follow the bound RPC rules: public HTTPS and no query", () => {
  assert.throws(() => bridgeRpcCall(1, { ...primary, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example/?key=secret" }),
    { code: "APN_RPC_CONFIG", message: /bridge_archive_RPC_query_forbidden/u });
  assert.throws(() => bridgeRpcCall(1, { ...primary, APN_ETHEREUM_ARCHIVE_RPC_URL: "http://archive.example" }), { code: "APN_RPC_CONFIG" });
  assert.throws(() => bridgeArchiveEndpoint(10 as never, { APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" }), { code: "APN_RPC_CONFIG" });
});

test("archive HTTP failures remain generic and do not leak the response body", async () => {
  const secret = "archive-provider-secret-canary";
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as { method: string };
    if (new URL(endpoint).host === "archive.example" && request.method !== "eth_chainId") {
      return { status: 503, body: JSON.stringify({ error: secret }) };
    }
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: "1", result: "0x1" }) };
  } };
  await assert.rejects(bridgeRpcCall(1, withArchive, { transport }).call("eth_getCode", [DIAMOND, "0x18c9a42"]),
    (error: unknown) => error instanceof Error && error.message.includes("bridge_RPC_HTTP_status") && !error.message.includes(secret));
});

test("only exact block-pinned state reads qualify as historical", () => {
  assert.equal(isHistoricalStateRead("eth_getCode", [DIAMOND, "0x18c9a42"]), true);
  assert.equal(isHistoricalStateRead("eth_getCode", [DIAMOND, "safe"]), false);
  assert.equal(isHistoricalStateRead("eth_getCode", [DIAMOND.toLowerCase()]), false);
  assert.equal(isHistoricalStateRead("eth_getCode", [DIAMOND, "0x012"]), false);
  assert.equal(isHistoricalStateRead("eth_getStorageAt", [DIAMOND, "0x0", "0x10"]), true);
  assert.equal(isHistoricalStateRead("eth_getStorageAt", [DIAMOND, "0x10"]), false);
  assert.equal(isHistoricalStateRead("eth_call", [{ to: DIAMOND }, { blockHash: `0x${"a".repeat(64)}` }]), true);
  assert.equal(isHistoricalStateRead("eth_call", [{ to: DIAMOND }, { blockHash: "0xdeadbeef" }]), false);
  assert.equal(isHistoricalStateRead("eth_call", [{ to: DIAMOND }, "latest"]), false);
  assert.equal(isHistoricalStateRead("eth_getBalance", ["0x0", "0x10"]), false);
  assert.equal(isHistoricalStateRead("eth_sendRawTransaction", ["0x02"]), false);
  assert.equal(isHistoricalStateRead("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]), false);
  assert.equal(isHistoricalStateRead("eth_getLogs", [{ fromBlock: "0x1", toBlock: "safe" }]), false);
  assert.equal(isHistoricalStateRead("eth_getBlockByNumber", ["0x10", false]), false);
  assert.equal(isArchiveRead("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]), true);
  assert.equal(isArchiveRead("eth_getTransactionReceipt", ["0xdeadbeef"]), false);
  assert.equal(isArchiveRead("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`, "extra"]), false);
  assert.equal(isArchiveRead("eth_sendRawTransaction", [`0x${"b".repeat(64)}`]), false);
});
