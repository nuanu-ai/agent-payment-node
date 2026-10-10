import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { canonicalJson } from "../../src/canonical.js";
import { MULTICALL3_ABI } from "../../src/portfolio/evm-reader.js";
import { MULTICALL3_ADDRESS } from "../../src/portfolio/registry.js";
import { bridgeRpcFactory, BridgeRpcPhysicalBudget, RpcReadSession } from "../../src/lifi/rpc.js";
import type { BridgeEnvelope } from "../../src/lifi/model.js";

const captured = JSON.parse(await readFile("tests/core/lifi-fixtures/base-native-across-observation-rpc-20261008.json", "utf8"));
const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize)
  : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
    : typeof value === "string" && value.startsWith("0x") ? value.toLowerCase() : value;
const key = (role: string, method: string, params: unknown[]) => canonicalJson({ role, method, params: normalize(params) });
const role = (url: string) => url.includes("publicnode.com") ? "primary" : url.includes("tenderly.co") ? "archive" : "receipt";

function reader(mutation?: "configuration" | "multicall_code") {
  const responses = new Map<string, unknown>();
  for (const row of captured.rows) {
    const identity = key(row.role, row.method, row.params);
    if (responses.has(identity)) assert.deepEqual(responses.get(identity), row.result);
    responses.set(identity, row.result);
  }
  let now = Date.parse(captured.capturedAt[0]);
  const wait = async (ms: number) => { now += ms; };
  const physical = new BridgeRpcPhysicalBudget(() => now, wait);
  const session = new RpcReadSession({ now: () => now, wait, maxHttpRequests: 14, maxHttpAttempts: 16,
    archiveDeploymentBatchMaxItems: 3, physicalBudget: physical });
  const posts: Array<{ role: string; count: number; methods: string[] }> = [];
  const read = (endpointRole: string, method: string, params: unknown[]): unknown => {
    assert.notEqual(method, "eth_sendRawTransaction");
    const identity = key(endpointRole, method, params);
    if (mutation === "multicall_code" && method === "eth_getCode" && String(params[0]).toLowerCase() === MULTICALL3_ADDRESS.toLowerCase()) return "0x6000";
    if (responses.has(identity)) return responses.get(identity);
    if (method === "eth_call") {
      const call = params[0] as { to: string; data: `0x${string}` };
      assert.equal(call.to.toLowerCase(), MULTICALL3_ADDRESS.toLowerCase());
      const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: call.data });
      assert.equal(decoded.functionName, "aggregate3");
      const calls = decoded.args![0] as readonly { target: string; allowFailure: boolean; callData: string }[];
      const results = calls.map((item, index) => {
        assert.equal(item.allowFailure, false);
        const original = responses.get(key(endpointRole, "eth_call", [{ to: item.target, data: item.callData }, params[1]]));
        assert.equal(typeof original, "string", "every new aggregate component must have an independently captured result");
        const bytes = original as `0x${string}`;
        return { success: true, returnData: mutation === "configuration" && index === 0 ?
          (`0x${(BigInt(bytes) ^ 1n).toString(16).padStart(bytes.length - 2, "0")}` as `0x${string}`) : bytes };
      });
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: results });
    }
    throw new Error(`Uncaptured read ${identity}`);
  };
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base-rpc.publicnode.com",
    APN_BASE_ARCHIVE_RPC_URL: "https://base.gateway.tenderly.co", APN_BASE_RECEIPT_RPC_URL: "https://mainnet.base.org" }, { wait, transport: {
      async request(url, method, body) {
        assert.equal(method, "POST");
        const parsed = JSON.parse(body!) as { id: string; method: string; params: unknown[] } | Array<{ id: string; method: string; params: unknown[] }>;
        const items = Array.isArray(parsed) ? parsed : [parsed], endpointRole = role(url);
        posts.push({ role: endpointRole, count: items.length, methods: items.map(item => item.method) });
        const values = items.map(item => ({ jsonrpc: "2.0", id: item.id, result: read(endpointRole, item.method, item.params) }));
        return { status: 200, headers: {}, body: JSON.stringify(Array.isArray(parsed) ? values : values[0]) };
      },
    } })(8453, session);
  return { rpc, session, physical, posts };
}

test("Base native Across observation and exact historical deployment fit the unchanged 14 POST source budget", async () => {
  const r = reader();
  const observed = await r.rpc.observe(captured.transactionHash, captured.envelope as BridgeEnvelope);
  assert(observed); assert(observed.transaction.safeBlock);
  assert.equal(observed.transaction.actualTotalFeeWei, "899986077215");
  assert.deepEqual(observed.transaction.block, captured.observed.transaction.block);
  const deployment = await r.rpc.deployment("across", 1, "0x0000000000000000000000000000000000000000", observed.transaction.block, true);
  assert.deepEqual(deployment, captured.historical);
  assert(r.session.telemetry().httpRequests <= 14);
  assert(r.session.telemetry().httpAttempts <= 16);
  assert(r.physical.remaining() >= 10);
  assert(r.posts.filter(post => post.role === "archive").every(post => post.count <= 3));
  assert(r.posts.every(post => !post.methods.includes("eth_sendRawTransaction")));
});

test("Base Across aggregation still refuses a changed independently captured configuration component", async () => {
  const r = reader("configuration");
  const observed = await r.rpc.observe(captured.transactionHash, captured.envelope as BridgeEnvelope); assert(observed);
  await assert.rejects(r.rpc.deployment("across", 1, "0x0000000000000000000000000000000000000000", observed.transaction.block, true),
    { code: "APN_PROVIDER_PROTOCOL" });
});

test("Base Across historical aggregation requires the exact reviewed Multicall bytecode", async () => {
  const r = reader("multicall_code");
  await assert.rejects(r.rpc.deployment("across", 1, "0x0000000000000000000000000000000000000000", captured.observed.transaction.block, true),
    { code: "APN_PROVIDER_PROTOCOL" });
});
