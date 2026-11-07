import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { publicBridgeOperation } from "../../src/lifi/receipt.js";
import { bridgeRpcCall } from "../../src/lifi/rpc.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";

const HASH = `0x${"b".repeat(64)}`;
const RECEIPT = { transactionHash: HASH, status: "0x1", blockNumber: "0x10", blockHash: `0x${"c".repeat(64)}` };
// PublicNode's refusal as its keyless roots answered on 2026-11-08 (Base, BSC and Arbitrum alike).
const REFUSAL = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602,
  message: "Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode" } });

function transport(refusal: string, chainHex: string, calls: Array<{ host: string; methods: string[] }>) {
  return { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string } | Array<{ id: string; method: string }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed], host = new URL(endpoint).host;
    calls.push({ host, methods: requests.map((request) => request.method) });
    if (host.endsWith("publicnode.com")) return { status: 403, body: refusal };
    const responses = requests.map((request) => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? chainHex : RECEIPT }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
}

for (const row of [
  { chainId: 56 as const, chainHex: "0x38", name: "BNB", origin: "https://bsc-rpc.publicnode.com" },
  { chainId: 8453 as const, chainHex: "0x2105", name: "BASE", origin: "https://base-rpc.publicnode.com" },
  { chainId: 42161 as const, chainHex: "0xa4b1", name: "ARBITRUM", origin: "https://arbitrum-one-rpc.publicnode.com" },
]) test(`PublicNode's current historical refusal on chain ${row.chainId} re-reads the receipt through the archive`, async () => {
  const calls: Array<{ host: string; methods: string[] }> = [];
  const environment = { [`APN_${row.name}_RPC_URL`]: `${row.origin}/`, [`APN_${row.name}_ARCHIVE_RPC_URL`]: "https://archive.example" };
  const read = bridgeRpcCall(row.chainId, environment, { transport: transport(REFUSAL, row.chainHex, calls) });
  assert.deepEqual(await read.call("eth_getTransactionReceipt", [HASH]), RECEIPT);
  assert.deepEqual(calls, [
    { host: new URL(row.origin).host, methods: ["eth_getTransactionReceipt"] },
    { host: "archive.example", methods: ["eth_chainId", "eth_getTransactionReceipt"] },
  ]);
});

test("a refusal with another sign-up link, or from another origin, never falls back", async () => {
  const other = REFUSAL.replace("https://www.allnodes.com/publicnode", "https://elsewhere.example");
  for (const [body, primary] of [[other, "https://bsc-rpc.publicnode.com/"], [REFUSAL, "https://bsc.publicnode.com/"]] as const) {
    const calls: Array<{ host: string; methods: string[] }> = [];
    const environment = { APN_BNB_RPC_URL: primary, APN_BNB_ARCHIVE_RPC_URL: "https://archive.example" };
    await assert.rejects(bridgeRpcCall(56, environment, { transport: transport(body, "0x38", calls) }).call("eth_getTransactionReceipt", [HASH]),
      (error: unknown) => { assert.ok(error instanceof ApnError); assert.equal(error.code, "APN_RPC_PROTOCOL");
        assert.equal(error.details?.httpStatus, "403"); return true; });
    assert.deepEqual(calls.map((call) => call.host), [new URL(primary).host]);
  }
});

test("an RPC refusal stored on an unresolved bridge names that chain's receipt and archive readers", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb");
  s.provider.statusValue = "completed_observed";
  s.destination.observe = async () => {
    throw new ApnError("APN_RPC_PROTOCOL", "Bridge validation failed: bridge_RPC_HTTP_status.",
      { rpcMethod: "eth_getTransactionReceipt", httpStatus: "403", attempts: "1", endpointRole: "primary" });
  };
  const prepared = await s.prepare("across", "bnb-reader-hint-001");
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  const record = (await findStored(s.core.bridges.records, prepared.id))!;
  assert.equal(record.terminal, false); assert.equal(record.failure?.observationRpc?.httpStatus, 403, JSON.stringify({ state: record.state, failure: record.failure }));
  assert.equal(record.failure?.observationRpc?.stage.startsWith("destination_"), true);
  const actions = publicBridgeOperation(record).next_actions;
  assert.deepEqual(actions.slice(0, 2), [`apn operation resume --operation ${prepared.id}`, `apn operation status --operation ${prepared.id}`]);
  assert.equal(actions.length, 3);
  assert.match(actions[2]!, /^The primary RPC of chain 56 refused eth_getTransactionReceipt \(HTTP 403\)\. Set APN_BNB_RECEIPT_RPC_URL \(receipts\) and APN_BNB_ARCHIVE_RPC_URL /u);
  assert.match(actions[2]!, /accept JSON-RPC batches, then rerun: apn operation resume --operation [0-9a-f]{64}$/u);
});

test("a stored failure that is not an RPC refusal keeps the plain next actions", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb");
  s.provider.statusValue = "completed_observed";
  s.destination.observe = async () => { throw new ApnError("APN_RPC_AMBIGUOUS", "synthetic unavailable", { transportReason: "timeout" }); };
  const prepared = await s.prepare("across", "bnb-reader-hint-002");
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  const record = (await findStored(s.core.bridges.records, prepared.id))!;
  assert.equal(record.terminal, false); assert.equal(record.failure?.observationRpc?.code, "APN_RPC_AMBIGUOUS");
  assert.equal(record.failure?.observationRpc?.httpStatus, undefined);
  assert.deepEqual(publicBridgeOperation(record).next_actions,
    [`apn operation resume --operation ${prepared.id}`, `apn operation status --operation ${prepared.id}`]);
});
