import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { canonicalJson } from "../../src/canonical.js";
import { MULTICALL3_ABI } from "../../src/portfolio/evm-reader.js";
import { MULTICALL3_ADDRESS } from "../../src/portfolio/registry.js";
import { bridgeRpcFactory, BridgeRpcPhysicalBudget, RpcReadSession } from "../../src/lifi/rpc.js";
import { bridgeSourceObservationRequests } from "../../src/lifi/observation-budget.js";
import { BRIDGE_CANONICAL_OBSERVATION_POSTS } from "../../src/lifi/rpc-observation.js";
import type { BridgeEnvelope } from "../../src/lifi/model.js";

const captured = JSON.parse(await readFile("tests/core/lifi-fixtures/base-native-across-observation-rpc-20261008.json", "utf8"));
const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize)
  : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
    : typeof value === "string" && value.startsWith("0x") ? value.toLowerCase() : value;
const key = (role: string, method: string, params: unknown[]) => canonicalJson({ role, method, params: normalize(params) });
const role = (url: string) => url.includes("publicnode.com") ? "primary" : url.includes("tenderly.co") ? "archive" : "receipt";

function reader(mutation?: "configuration" | "multicall_code", requests = BRIDGE_CANONICAL_OBSERVATION_POSTS) {
  const responses = new Map<string, unknown>();
  for (const row of captured.rows) {
    const identity = key(row.role, row.method, row.params);
    if (responses.has(identity)) assert.deepEqual(responses.get(identity), row.result);
    responses.set(identity, row.result);
    // Reuse only captured numeric-header fixture bytes for the newly required primary recheck.
    // This is synthetic routing coverage, not evidence that a live primary returned this header.
    if (row.role === "archive" && row.method === "eth_getBlockByNumber" && /^0x[0-9a-f]+$/i.test(row.params[0])) {
      const primaryKey = key("primary", row.method, row.params);
      if (responses.has(primaryKey)) assert.deepEqual(responses.get(primaryKey), row.result);
      responses.set(primaryKey, row.result);
    }
  }
  let now = Date.parse(captured.capturedAt[0]);
  const wait = async (ms: number) => { now += ms; };
  const physical = new BridgeRpcPhysicalBudget(requests + 2);
  const session = new RpcReadSession({ now: () => now, wait, maxHttpRequests: requests, maxHttpAttempts: requests + 2,
    physicalBudget: physical });
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

test("a captured mainnet Base native Across observation replays on primary and receipt reader only, with the oracle-proven fee", async () => {
  const r = reader();
  const observed = await r.rpc.observe(captured.transactionHash, captured.envelope as BridgeEnvelope);
  assert(observed); assert(observed.transaction.safeBlock);
  // The receipt's own fee fields give the same total the legacy pinned-oracle proof recorded at capture time.
  assert.equal(observed.transaction.actualTotalFeeWei, "899986077215");
  const { feeEvidence: current, ...transaction } = observed.transaction, { feeEvidence: legacy, ...capturedTransaction } = captured.observed.transaction;
  assert.deepEqual(transaction, capturedTransaction); assert.equal(current.baseOracle, null); assert.notEqual(legacy.baseOracle, null);
  // One primary batch, the scalar receipt reader's chain identity and receipt, and the inclusion header: no archive, no deployment.
  assert.deepEqual(r.posts.map(post => post.role), ["primary", "receipt", "receipt", "primary"]);
  assert.equal(r.session.telemetry().httpRequests, BRIDGE_CANONICAL_OBSERVATION_POSTS); assert.equal(bridgeSourceObservationRequests(1), 8);
  assert(r.posts.every(post => !post.methods.includes("eth_sendRawTransaction")));
});
