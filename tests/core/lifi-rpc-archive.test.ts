import assert from "node:assert/strict";
import test from "node:test";
import { bridgeRpcCall, RpcReadSession } from "../../src/lifi/rpc.js";
import { ApnError } from "../../src/errors.js";
import { bridgeArchiveEndpoint, isArchiveRead, isHistoricalStateRead } from "../../src/lifi/rpc-archive.js";

function fixture(chainIds: Readonly<Record<string, string>> = {}, receipts: Readonly<Record<string, unknown>> = {}) {
  const calls: Array<{ host: string; method: string }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string } | Array<{ id: string; method: string }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    const host = new URL(endpoint).host;
    const responses = requests.map((request) => {
      calls.push({ host, method: request.method });
      const result = request.method === "eth_chainId" ? (chainIds[host] ?? "0x1")
        : request.method === "eth_getTransactionReceipt" && Object.hasOwn(receipts, host) ? receipts[host] : "0x60";
      return { jsonrpc: "2.0", id: request.id, result };
    });
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
  return { transport, calls };
}
const primary = { APN_ETHEREUM_RPC_URL: "https://primary.example" };
const withArchive = { ...primary, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" };
const DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const TRANSACTION_HASH = `0x${"b".repeat(64)}`;
const RECEIPT = { transactionHash: TRANSACTION_HASH, status: "0x1", blockNumber: "0x10", blockHash: `0x${"c".repeat(64)}` };

test("block-pinned state uses archive while a successful exact-hash receipt read stays on primary", async () => {
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
    { host: "primary.example", method: "eth_getTransactionReceipt" },
  ]);
});

test("a null primary receipt falls back once through a chain-checked archive", async () => {
  const f = fixture({}, { "primary.example": null, "archive.example": RECEIPT });
  assert.deepEqual(await bridgeRpcCall(1, withArchive, { transport: f.transport }).call("eth_getTransactionReceipt", [TRANSACTION_HASH]), RECEIPT);
  assert.deepEqual(f.calls, [
    { host: "primary.example", method: "eth_getTransactionReceipt" },
    { host: "archive.example", method: "eth_chainId" },
    { host: "archive.example", method: "eth_getTransactionReceipt" },
  ]);
});

test("the exact Base PublicNode historical receipt capability response falls back to the explicit archive", async () => {
  const calls: Array<{ host: string; method: string }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string } | Array<{ id: string; method: string }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed], host = new URL(endpoint).host;
    for (const request of requests) calls.push({ host, method: request.method });
    if (host === "base-rpc.publicnode.com" && requests[0]!.method === "eth_getTransactionReceipt") {
      return { status: 403, body: "  Archive requests require a personal token  " };
    }
    const responses = requests.map((request) => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x2105" : RECEIPT }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
  const environment = { APN_BASE_RPC_URL: "https://base-rpc.publicnode.com:443/", APN_BASE_ARCHIVE_RPC_URL: "https://archive.example" };
  assert.deepEqual(await bridgeRpcCall(8453, environment, { transport }).call("eth_getTransactionReceipt", [TRANSACTION_HASH]), RECEIPT);
  assert.deepEqual(calls, [
    { host: "base-rpc.publicnode.com", method: "eth_getTransactionReceipt" },
    { host: "archive.example", method: "eth_chainId" },
    { host: "archive.example", method: "eth_getTransactionReceipt" },
  ]);
});

test("an explicit official Base receipt endpoint rejects arrays but completes the atomic receipt read as two paced scalars", async () => {
  const bodies: unknown[] = [], waits: number[] = [];
  const environment = { APN_BASE_RPC_URL: "https://base-rpc.publicnode.com",
    APN_BASE_ARCHIVE_RPC_URL: "https://base-archive.example", APN_BASE_RECEIPT_RPC_URL: "https://mainnet.base.org" };
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string } | unknown[];
    if (new URL(endpoint).host === "base-rpc.publicnode.com") return { status: 403, body: "archive requests require a personal token" };
    bodies.push(parsed); assert.equal(Array.isArray(parsed), false, "official Base receipt endpoint rejects JSON-RPC arrays");
    const request = parsed as { id: string; method: string };
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x2105" : RECEIPT }) };
  } };
  const descriptor = bridgeRpcCall(8453, environment, { transport });
  const result = await descriptor.sessionCall(new RpcReadSession({ wait: async (milliseconds) => { waits.push(milliseconds); } }))
    ("eth_getTransactionReceipt", [TRANSACTION_HASH]);
  assert.deepEqual(result, RECEIPT);
  assert.deepEqual(bodies.map((body) => (body as { method: string }).method), ["eth_chainId", "eth_getTransactionReceipt"]);
  assert.deepEqual(waits, [750]);
});

test("receipt fallback cache is atomic when the second scalar decoder fails", async () => {
  let receiptAttempts = 0; const receiptMethods: string[] = [];
  const environment = { APN_BASE_RPC_URL: "https://primary.example", APN_BASE_ARCHIVE_RPC_URL: "https://archive.example",
    APN_BASE_RECEIPT_RPC_URL: "https://mainnet.base.org" };
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as { id: string; method: string };
    const host = new URL(endpoint).host;
    if (host === "primary.example") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: null }) };
    assert.equal(host, "mainnet.base.org"); receiptMethods.push(request.method);
    if (request.method === "eth_getTransactionReceipt") receiptAttempts += 1;
    const result = request.method === "eth_chainId" ? "0x2105" : receiptAttempts === 1 ? { ...RECEIPT, blockHash: "0xdeadbeef" } : RECEIPT;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  } };
  const descriptor = bridgeRpcCall(8453, environment, { transport });
  const call = descriptor.sessionCall(new RpcReadSession({ wait: async () => {} }));
  await assert.rejects(call("eth_getTransactionReceipt", [TRANSACTION_HASH]), { code: "APN_RPC_PROTOCOL" });
  assert.deepEqual(await call("eth_getTransactionReceipt", [TRANSACTION_HASH]), RECEIPT);
  assert.deepEqual(receiptMethods, ["eth_chainId", "eth_getTransactionReceipt", "eth_chainId", "eth_getTransactionReceipt"]);
});

test("wrong explicit receipt chain fails and state remains isolated on the archive endpoint", async () => {
  const calls: Array<{ host: string; method: string }> = [];
  const environment = { APN_ETHEREUM_RPC_URL: "https://primary.example", APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example",
    APN_ETHEREUM_RECEIPT_RPC_URL: "https://receipt.example" };
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string } | Array<{ id: string; method: string }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed], host = new URL(endpoint).host;
    for (const request of requests) calls.push({ host, method: request.method });
    const responses = requests.map((request) => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? host === "receipt.example" ? "0x2105" : "0x1"
        : request.method === "eth_getTransactionReceipt" ? host === "primary.example" ? null : RECEIPT : "0x60" }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
  const descriptor = bridgeRpcCall(1, environment, { transport });
  await descriptor.call("eth_getCode", [DIAMOND, "0x10"]);
  await assert.rejects(descriptor.call("eth_getTransactionReceipt", [TRANSACTION_HASH]), { code: "APN_RPC_CONFIG", message: /bridge_receipt_RPC_chain/u });
  assert.deepEqual(calls, [
    { host: "archive.example", method: "eth_chainId" }, { host: "archive.example", method: "eth_getCode" },
    { host: "primary.example", method: "eth_getTransactionReceipt" },
    { host: "receipt.example", method: "eth_chainId" }, { host: "receipt.example", method: "eth_getTransactionReceipt" },
  ]);
});

test("receipt route refuses logs and state before the explicit receipt endpoint transport", async () => {
  let receiptCalls = 0;
  const environment = { ...withArchive, APN_ETHEREUM_RECEIPT_RPC_URL: "https://receipt.example" };
  const transport = { request: async (endpoint: string) => { if (new URL(endpoint).host === "receipt.example") receiptCalls += 1;
    throw new Error("transport must remain unused"); } };
  const batch = bridgeRpcCall(1, environment, { transport }).sessionBatchCall(new RpcReadSession({ wait: async () => {} }));
  for (const item of [
    { method: "eth_getLogs", params: [{}] }, { method: "eth_getCode", params: [DIAMOND, "0x10"] },
    { method: "eth_getBlockByNumber", params: ["latest", false] }, { method: "eth_sendRawTransaction", params: ["0x02"] },
  ]) await assert.rejects(batch([{ ...item, cachePolicy: "none", decoder: String }], "receipt"),
    { code: "APN_RPC_CONFIG", message: /bridge_receipt_RPC_method/u });
  assert.equal(receiptCalls, 0);
});

test("the exact Ethereum PublicNode historical receipt capability response falls back only from its root origin", async () => {
  const calls: Array<{ host: string; methods: string[] }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string } | Array<{ id: string; method: string }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed], host = new URL(endpoint).host;
    calls.push({ host, methods: requests.map((request) => request.method) });
    if (host === "ethereum-rpc.publicnode.com") return { status: 403, body: "archive requests require a personal token" };
    const responses = requests.map((request) => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x1" : RECEIPT }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
  const environment = { APN_ETHEREUM_RPC_URL: "https://ethereum-rpc.publicnode.com/", APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" };
  assert.deepEqual(await bridgeRpcCall(1, environment, { transport }).call("eth_getTransactionReceipt", [TRANSACTION_HASH]), RECEIPT);
  assert.deepEqual(calls, [
    { host: "ethereum-rpc.publicnode.com", methods: ["eth_getTransactionReceipt"] },
    { host: "archive.example", methods: ["eth_chainId", "eth_getTransactionReceipt"] },
  ]);
});

for (const row of [
  { name: "generic HTTP 403 credential rejection", chainId: 8453 as const,
    environment: { APN_BASE_RPC_URL: "https://base-rpc.publicnode.com", APN_BASE_ARCHIVE_RPC_URL: "https://archive.example" },
    status: 403, message: "invalid API credential" },
  { name: "exact phrase on a non-Base chain", chainId: 1 as const, environment: withArchive,
    status: 403, message: "archive requests require a personal token" },
  { name: "exact phrase on another Base origin", chainId: 8453 as const,
    environment: { APN_BASE_RPC_URL: "https://base-other.example", APN_BASE_ARCHIVE_RPC_URL: "https://archive.example" },
    status: 403, message: "archive requests require a personal token" },
  { name: "HTTP 401 even with the exact phrase", chainId: 8453 as const,
    environment: { APN_BASE_RPC_URL: "https://base-rpc.publicnode.com", APN_BASE_ARCHIVE_RPC_URL: "https://archive.example" },
    status: 401, message: "archive requests require a personal token" },
] as const) test(`${row.name} never falls back`, async () => {
  const calls: string[] = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    calls.push(new URL(endpoint).host); JSON.parse(body!);
    return { status: row.status, body: row.message };
  } };
  await assert.rejects(bridgeRpcCall(row.chainId, row.environment, { transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]),
    (error: unknown) => { assert.ok(error instanceof ApnError); assert.equal(error.code, "APN_RPC_PROTOCOL");
      assert.equal(error.details?.httpStatus, row.status.toString()); return true; });
  assert.equal(calls.length, 1); assert.notEqual(calls[0], "archive.example");
});

for (const message of ["archive token required for this credential", "historical receipt unavailable: authorization required"]) {
  test(`credentialed JSON-RPC rejection never falls back: ${message}`, async () => {
    const calls: string[] = [];
    const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
      calls.push(new URL(endpoint).host); const request = JSON.parse(body!) as { id: string };
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id,
        error: { code: -32000, message } }) };
    } };
    await assert.rejects(bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base-rpc.publicnode.com",
      APN_BASE_ARCHIVE_RPC_URL: "https://archive.example" }, { transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]),
      { code: "APN_RPC_PROTOCOL" });
    assert.deepEqual(calls, ["base-rpc.publicnode.com"]);
  });
}

test("a capability error without the classified receipt reason fails closed", async () => {
  const calls: string[] = [];
  const transport = { request: async (endpoint: string) => {
    calls.push(new URL(endpoint).host);
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "unclassified capability error", { rpcMethod: "eth_getTransactionReceipt" });
  } };
  await assert.rejects(bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base-rpc.publicnode.com",
    APN_BASE_ARCHIVE_RPC_URL: "https://archive.example" }, { transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]),
    { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.deepEqual(calls, ["base-rpc.publicnode.com"]);
});

test("an explicit pruned-history JSON-RPC error falls back without accepting arbitrary protocol errors", async () => {
  const calls: Array<{ host: string; method: string }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string } | Array<{ id: string; method: string }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed], host = new URL(endpoint).host;
    for (const request of requests) calls.push({ host, method: request.method });
    if (host === "primary.example") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: requests[0]!.id,
      error: { code: -32000, message: "historical receipt unavailable: pruned data" } }) };
    const responses = requests.map((request) => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x1" : RECEIPT }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
  assert.deepEqual(await bridgeRpcCall(1, withArchive, { transport }).call("eth_getTransactionReceipt", [TRANSACTION_HASH]), RECEIPT);
  assert.deepEqual(calls, [
    { host: "primary.example", method: "eth_getTransactionReceipt" },
    { host: "archive.example", method: "eth_chainId" },
    { host: "archive.example", method: "eth_getTransactionReceipt" },
  ]);
});

test("primary and archive receipt unavailability has a stable bounded error", async () => {
  const calls: Array<{ host: string; method: string }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string } | Array<{ id: string; method: string }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed], host = new URL(endpoint).host;
    for (const request of requests) calls.push({ host, method: request.method });
    if (host === "primary.example") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: requests[0]!.id, result: null }) };
    return { status: 503, body: "archive unavailable" };
  } };
  await assert.rejects(bridgeRpcCall(1, withArchive, { transport, wait: async () => {} }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]),
    { code: "APN_RPC_PROTOCOL", details: { rpcMethod: "eth_getTransactionReceipt", httpStatus: "503", attempts: "2" } });
  assert.deepEqual(calls, [
    { host: "primary.example", method: "eth_getTransactionReceipt" },
    { host: "archive.example", method: "eth_chainId" },
    { host: "archive.example", method: "eth_getTransactionReceipt" },
    { host: "archive.example", method: "eth_chainId" },
    { host: "archive.example", method: "eth_getTransactionReceipt" },
  ]);
});

test("malformed successful primary data is a validation failure and never falls back", async () => {
  const calls: string[] = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    calls.push(new URL(endpoint).host); const request = JSON.parse(body!) as { id: string };
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id }) };
  } };
  await assert.rejects(bridgeRpcCall(1, withArchive, { transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]),
    { code: "APN_RPC_PROTOCOL" });
  assert.deepEqual(calls, ["primary.example"]);
});

test("an archive URL with the primary origin never duplicates a null receipt read", async () => {
  const calls: string[] = [];
  const environment = { ...primary, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://primary.example/archive" };
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    calls.push(`${new URL(endpoint).pathname}:${(JSON.parse(body!) as { method: string }).method}`);
    const request = JSON.parse(body!) as { id: string }; return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: null }) };
  } };
  assert.equal(await bridgeRpcCall(1, environment, { transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]), null);
  assert.deepEqual(calls, ["/:eth_getTransactionReceipt"]);
});

test("without an archive name historical state fails before a state read reaches the primary", async () => {
  const f = fixture();
  await assert.rejects(bridgeRpcCall(1, primary, { transport: f.transport }).call("eth_getCode", [DIAMOND, "0x18c9a42"]),
    { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE", details: { reason: "distinct_archive_RPC_required" } });
  await bridgeRpcCall(1, primary, { transport: f.transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]);
  assert.deepEqual(f.calls, [
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
    { host: "primary.example", method: "eth_getTransactionReceipt" },
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
  const f = fixture({ "archive.example": "0x2105" }, { "primary.example": null });
  await assert.rejects(bridgeRpcCall(1, withArchive, { transport: f.transport }).call("eth_getTransactionReceipt", [`0x${"b".repeat(64)}`]),
    { code: "APN_RPC_CONFIG", message: /bridge_archive_RPC_chain/u });
  assert.deepEqual(f.calls, [{ host: "primary.example", method: "eth_getTransactionReceipt" },
    { host: "archive.example", method: "eth_chainId" }, { host: "archive.example", method: "eth_getTransactionReceipt" }]);
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

test("archive batches reject moving, estimation, log and effect methods before transport", async () => {
  let calls = 0;
  const transport = { request: async () => { calls += 1; throw new Error("transport must remain unused"); } };
  const batch = bridgeRpcCall(1, withArchive, { transport }).sessionBatchCall(new RpcReadSession({ wait: async () => {} }));
  for (const item of [
    { method: "eth_getBlockByNumber", params: ["safe", false] },
    { method: "eth_estimateGas", params: [{}] },
    { method: "eth_getLogs", params: [{}] },
    { method: "eth_sendRawTransaction", params: ["0x02"] },
  ]) {
    await assert.rejects(batch([{ ...item, cachePolicy: "none", decoder: String }], "archive"),
      { code: "APN_RPC_CONFIG", message: /bridge_archive_RPC_method/u });
  }
  assert.equal(calls, 0);
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
  assert.throws(() => bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://primary.example",
    APN_BASE_RECEIPT_RPC_URL: "https://mainnet.base.org/?key=secret" }), { code: "APN_RPC_CONFIG", message: /bridge_receipt_RPC_query_forbidden/u });
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
