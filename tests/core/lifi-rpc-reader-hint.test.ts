import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { bridgeReceipt, publicBridgeOperation } from "../../src/lifi/receipt.js";
import { bridgeRpcCall, bridgeRpcFactory, RpcReadSession } from "../../src/lifi/rpc.js";
import { lifiFixture } from "./lifi-helpers.js";
import { quantity, rpcObservation, word } from "./lifi-rpc-fixtures.js";
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

const refused = (role: string, method: string | undefined, status: string, variable: string) => (id: string) =>
  `The ${role} RPC of chain 56 refused ${method ?? "a read"} (HTTP ${status}). If it keeps refusing, set ${variable} ` +
  `to an HTTPS endpoint that serves this read, then rerun: apn operation resume --operation ${id}`;
for (const row of [
  { name: "a primary receipt", details: { rpcMethod: "eth_getTransactionReceipt", httpStatus: "403", endpointRole: "primary" },
    expected: refused("primary", "eth_getTransactionReceipt", "403", "APN_BNB_RECEIPT_RPC_URL") },
  { name: "a primary trace", details: { rpcMethod: "debug_traceTransaction", httpStatus: "403", endpointRole: "primary" },
    expected: refused("primary", "debug_traceTransaction", "403", "APN_BNB_ARCHIVE_RPC_URL") },
  { name: "a primary log read", details: { rpcMethod: "eth_getLogs", httpStatus: "403", endpointRole: "primary" },
    expected: refused("primary", "eth_getLogs", "403", "APN_BNB_RPC_URL") },
  // Keyless Tatum as the archive standing in for a receipt reader: the receipt batch is refused with 402, no method.
  { name: "an archive receipt batch", details: { httpStatus: "402", endpointRole: "archive" },
    expected: refused("archive", undefined, "402", "APN_BNB_RECEIPT_RPC_URL") },
  { name: "an archive trace", details: { rpcMethod: "debug_traceTransaction", httpStatus: "402", endpointRole: "archive" },
    expected: refused("archive", "debug_traceTransaction", "402", "APN_BNB_ARCHIVE_RPC_URL") },
  { name: "a receipt reader chain check", details: { rpcMethod: "eth_chainId", httpStatus: "503", endpointRole: "receipt" },
    expected: refused("receipt", "eth_chainId", "503", "APN_BNB_RECEIPT_RPC_URL") },
  { name: "a missing archive", details: { reason: "explicit_archive_RPC_required" },
    expected: (id: string) => `Chain 56 needs an archive endpoint for this proof: set APN_BNB_ARCHIVE_RPC_URL, then rerun: apn operation resume --operation ${id}` },
]) test(`${row.name} refusal stored on an unresolved bridge names its reader in status only`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb");
  s.provider.statusValue = "completed_observed";
  s.destination.observe = async () => {
    throw new ApnError("APN_RPC_PROTOCOL", "Bridge validation failed: bridge_RPC_HTTP_status.", { attempts: "1", ...row.details });
  };
  const prepared = await s.prepare("across", `bnb-reader-hint-${row.name.replaceAll(" ", "-")}`);
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  const record = (await findStored(s.core.bridges.records, prepared.id))!;
  assert.equal(record.terminal, false, JSON.stringify({ state: record.state, failure: record.failure }));
  assert.equal(record.failure?.observationRpc?.stage.startsWith("destination_"), true);
  const plain = [`apn operation resume --operation ${prepared.id}`, `apn operation status --operation ${prepared.id}`];
  assert.deepEqual(publicBridgeOperation(record).next_actions, [...plain, row.expected(prepared.id)]);
  // Stored receipts hash their next actions: the receipt keeps the plain ones, so a receipt written earlier still verifies.
  assert.deepEqual(bridgeReceipt(record).next_actions, plain);
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

for (const row of [
  { chainId: 1 as const, primary: "https://ethereum-rpc.publicnode.com", rpc: "APN_ETHEREUM_RPC_URL", archive: "APN_ETHEREUM_ARCHIVE_RPC_URL" },
  { chainId: 56 as const, primary: "https://bsc-rpc.publicnode.com", rpc: "APN_BNB_RPC_URL", archive: "APN_BNB_ARCHIVE_RPC_URL" },
]) test(`canonical observation on chain ${row.chainId} reads a PublicNode-refused receipt through the archive`, async () => {
  // The live shape (2026-11-08): in a batch PublicNode answers 200 with the receipt as a sub-error; alone it answers 403.
  const s = await rpcObservation(row.chainId), posts: Array<{ host: string; batch: boolean; methods: string[] }> = [];
  const refusal = (JSON.parse(REFUSAL) as { error: unknown }).error, primaryHost = new URL(row.primary).host;
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string; params: unknown[] } | Array<{ id: string; method: string; params: unknown[] }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed], host = new URL(endpoint).host;
    posts.push({ host, batch: Array.isArray(parsed), methods: requests.map((request) => request.method) });
    if (host === primaryHost && !Array.isArray(parsed) && parsed.method === "eth_getTransactionReceipt") return { status: 403, body: REFUSAL };
    const responses = requests.map((request) => {
      if (host === primaryHost && request.method === "eth_getTransactionReceipt") return { jsonrpc: "2.0", id: request.id, error: refusal };
      const result = request.method === "eth_chainId" ? quantity(row.chainId) : request.method === "eth_getTransactionByHash" ? s.tx
        : request.method === "eth_getTransactionReceipt" ? s.receipt
        : request.params[0] === "safe" ? { ...s.block, number: "0x7d1", hash: word(99n) } : s.block;
      return { jsonrpc: "2.0", id: request.id, result };
    });
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
  const factory = bridgeRpcFactory({ [row.rpc]: row.primary, [row.archive]: "https://archive.example" }, { transport, wait: async () => {} });
  const observed = await factory(row.chainId, new RpcReadSession({ wait: async () => {} })).observeDestination!(s.hash);
  assert.equal(observed?.transaction.transactionHash, s.hash);
  assert.ok(posts.some((post) => post.host === primaryHost && !post.batch && post.methods[0] === "eth_getTransactionReceipt"));
  assert.deepEqual(posts.filter((post) => post.host === "archive.example").map((post) => post.methods),
    [["eth_chainId", "eth_getTransactionReceipt"]]);
});
