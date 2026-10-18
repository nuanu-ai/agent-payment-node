/** Synthetic HTTP only: actual CircleRpc encoding/decoding, no public provider. */
import assert from "node:assert/strict";
import test from "node:test";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN } from "../../src/circle-v2-evm/catalog.js";
for (const result of ["0x10000", null, "nothex", "missing"] as const) test(`initial estimate latest wire tag and strict result ${result}`, async () => {
  const requests: { method: string; params: unknown[] }[] = [];
  // Reads issued together leave as one JSON-RPC batch POST; each item is answered in kind.
  const rpc = new CircleRpc("https://estimate-test.example", 42161, { request: async (_url, method, body) => {
    assert.equal(method, "POST"); const parsed = JSON.parse(body!), batch = Array.isArray(parsed);
    const rows = (batch ? parsed : [parsed]).map((q: { id: number; method: string; params: unknown[] }) => { requests.push(q);
      const value = q.method === "eth_chainId" ? "0xa4b1" : q.method === "eth_getBlockByNumber" ? { number: "0x10", hash: `0x${"ab".repeat(32)}`, baseFeePerGas: "0x1" } : result;
      return { jsonrpc: "2.0", id: q.id, ...(q.method === "eth_estimateGas" && result === "missing" ? {} : { result: value }) }; });
    return { status: 200, body: JSON.stringify(batch ? rows : rows[0]) };
  } });
  const action = rpc.envelope(CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, "0x1234", "1");
  if (result === "0x10000") { const e = await action; assert.equal(e.gasLimitAtomic, "78644"); assert.equal(e.maxFeePerGasAtomic, "2");
    assert.deepEqual(e.eraBlock, { numberAtomic: "16", hash: `0x${"ab".repeat(32)}` }); }
  else await assert.rejects(action);
  assert.deepEqual(requests.map(q => q.method), ["eth_chainId", "eth_getBlockByNumber", "eth_estimateGas"]);
  assert.deepEqual(requests[1]!.params, ["latest", false]);
  assert.deepEqual(requests[2]!.params, [{ from: CIRCLE_SOURCE_OWNER, to: CIRCLE_SOURCE_TOKEN, data: "0x1234", value: "0x0" }, "latest"]);
});
