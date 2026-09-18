import assert from "node:assert/strict";
import test from "node:test";
import { bridgeRpcCall } from "../../src/lifi/rpc.js";
import { isHistoricalStateRead } from "../../src/lifi/rpc-archive.js";

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

test("block-pinned state reads go to the owner-named archive after one chain check; everything else stays on the bound RPC", async () => {
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

test("without an archive name every read stays on the bound RPC", async () => {
  const f = fixture();
  await bridgeRpcCall(1, primary, { transport: f.transport }).call("eth_getCode", [DIAMOND, "0x18c9a42"]);
  assert.deepEqual(f.calls, [{ host: "primary.example", method: "eth_getCode" }]);
});

test("an archive reader on another chain is refused before any historical read", async () => {
  const f = fixture({ "archive.example": "0x2105" });
  await assert.rejects(bridgeRpcCall(1, withArchive, { transport: f.transport }).call("eth_getCode", [DIAMOND, "0x18c9a42"]),
    { code: "APN_RPC_CONFIG", message: /bridge_archive_RPC_chain/u });
  assert.deepEqual(f.calls, [{ host: "archive.example", method: "eth_chainId" }]);
});

test("archive endpoints follow the bound RPC rules: public HTTPS and no query", () => {
  assert.throws(() => bridgeRpcCall(1, { ...primary, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example/?key=secret" }),
    { code: "APN_RPC_CONFIG", message: /bridge_archive_RPC_query_forbidden/u });
  assert.throws(() => bridgeRpcCall(1, { ...primary, APN_ETHEREUM_ARCHIVE_RPC_URL: "http://archive.example" }), { code: "APN_RPC_CONFIG" });
});

test("only exact block-pinned state reads qualify as historical", () => {
  assert.equal(isHistoricalStateRead("eth_getCode", [DIAMOND, "0x18c9a42"]), true);
  assert.equal(isHistoricalStateRead("eth_getCode", [DIAMOND, "safe"]), false);
  assert.equal(isHistoricalStateRead("eth_getCode", [DIAMOND.toLowerCase()]), false);
  assert.equal(isHistoricalStateRead("eth_getCode", [DIAMOND, "0x012"]), false);
  assert.equal(isHistoricalStateRead("eth_getStorageAt", [DIAMOND, "0x0", "0x10"]), true);
  assert.equal(isHistoricalStateRead("eth_getStorageAt", [DIAMOND, "0x10"]), false);
  assert.equal(isHistoricalStateRead("eth_call", [{ to: DIAMOND }, { blockHash: `0x${"a".repeat(64)}` }]), true);
  assert.equal(isHistoricalStateRead("eth_call", [{ to: DIAMOND }, "latest"]), false);
  assert.equal(isHistoricalStateRead("eth_getBalance", ["0x0", "0x10"]), false);
  assert.equal(isHistoricalStateRead("eth_sendRawTransaction", ["0x02"]), false);
});
