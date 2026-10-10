import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { temporaryState } from "./helpers.js";
import { lifiFixture } from "./lifi-helpers.js";
import { bridgeRpcFactory, BridgeRpcPhysicalBudget, RpcReadSession } from "../../src/lifi/rpc.js";

const raw = await readFile("tests/core/lifi-fixtures/linea-native-fill-rpc-20260920.json", "utf8");
assert.equal(sha256(raw), "ecc7d70307afd5d529965c5f37139df5380958408b28524b9e089917b1900b04");
const capture = JSON.parse(raw);
const traceOptions = { tracer: "callTracer", tracerConfig: { onlyTopCall: false, withLog: false } };
const identity = (method: string, params: readonly unknown[]) => canonicalJson([method, params]);
type Mutation = "chain" | "error" | "missing" | "malformed" | "large" | "trace" | "receipt" | "canonical" | "reanchor";

function reader(mutation?: Mutation, limits: { maxHttpRequests?: number; deadlineMs?: number } = {}) {
  const values = new Map<string, unknown>(capture.requests.map((row: any) =>
    [identity(row.request.method, row.request.params), row.response.result]));
  let now = Date.parse(capture.capturedAt);
  const epoch = now, wait = async (milliseconds: number) => { await new Promise<void>((resolve) => setImmediate(resolve)); now += milliseconds; };
  const physical = new BridgeRpcPhysicalBudget(() => now, wait);
  const session = new RpcReadSession({ now: () => now, wait, physicalBudget: physical, maxReadAttempts: 1,
    archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 28, maxHttpAttempts: 30, deadlineMs: 60_000, ...limits });
  const posts: Array<{ role: string; methods: string[]; at: number }> = [];
  const rpc = bridgeRpcFactory({ APN_LINEA_RPC_URL: "https://linea-rpc.publicnode.com",
    APN_LINEA_ARCHIVE_RPC_URL: capture.rpcOrigin }, { wait, transport: {
      async request(url, verb, body) {
        assert.equal(verb, "POST");
        const parsed = JSON.parse(body!), requests = Array.isArray(parsed) ? parsed : [parsed];
        const role = new URL(url).origin === capture.rpcOrigin ? "archive" : "primary";
        posts.push({ role, methods: requests.map((row: any) => row.method), at: now });
        const responses = requests.map((request: any) => {
          assert.notEqual(request.method, "eth_sendRawTransaction");
          if (request.method === "debug_traceTransaction") {
            assert.deepEqual(request.params, [capture.transactionHash, traceOptions]);
            if (role === "primary" || mutation === "error") return { jsonrpc: "2.0", id: request.id,
              error: { code: -32601, message: "the method debug_traceTransaction does not exist/is not available" } };
            if (mutation === "missing") return { jsonrpc: "2.0", id: request.id };
          }
          const key = identity(request.method, request.params);
          assert(values.has(key), `uncaptured read ${key}`);
          let result: any = structuredClone(values.get(key));
          if (role === "archive" && mutation === "chain" && request.method === "eth_chainId") result = "0x1";
          if (request.method === "debug_traceTransaction") {
            if (mutation === "malformed") result = null;
            if (mutation === "large") result.padding = "x".repeat(1024 * 1024);
            if (mutation === "trace") result.calls = [];
          }
          if (mutation === "receipt" && request.method === "eth_getTransactionReceipt") result.transactionHash = `0x${"ff".repeat(32)}`;
          if (mutation === "canonical" && request.method === "eth_getBlockByNumber" && request.params[0] === capture.receiptBlock.number) result.transactions = [];
          if (mutation === "reanchor" && role === "archive" && request.method === "eth_getBlockByNumber" && request.params[0] === capture.receiptBlock.number) result.hash = `0x${"ff".repeat(32)}`;
          return { jsonrpc: "2.0", id: request.id, result };
        });
        return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
      },
    } })(59144, session);
  return { rpc, session, posts, epoch };
}

test("Linea native fill uses one exact chain-checked archive trace while retaining primary origin and shared pacing", async () => {
  const r = reader(), observed = await r.rpc.observeDestination!(capture.transactionHash, capture.expected);
  assert(observed);
  assert.equal(observed.transaction.rpcOrigin, "https://linea-rpc.publicnode.com");
  assert.equal(observed.receipt.nativeTransfer?.valueAtomic, capture.expected.amountAtomic);
  assert.equal(observed.receipt.nativeTransfer?.to, capture.expected.recipient);
  assert.deepEqual(r.posts.filter(row => row.methods.includes("debug_traceTransaction")),
    [{ role: "archive", methods: ["eth_chainId", "debug_traceTransaction"], at: r.posts.find(row => row.methods.includes("debug_traceTransaction"))!.at }]);
  const telemetry = r.session.telemetry();
  assert.equal(telemetry.batchItemsByMethod.debug_traceTransaction, 1);
  assert.equal(telemetry.deadline, r.epoch + 60_000);
  assert(r.posts.length <= 20);
  for (let index = 1; index < r.posts.length; index++) assert(r.posts[index]!.at - r.posts[index - 1]!.at >= 500);
});

for (const mutation of ["chain", "error", "missing", "malformed", "large", "trace", "receipt", "canonical", "reanchor"] as const) {
  test(`Linea archive native observation rejects ${mutation}`, async () => {
    const r = reader(mutation);
    await assert.rejects(r.rpc.observeDestination!(capture.transactionHash, capture.expected));
    assert(r.posts.every(row => !row.methods.includes("eth_sendRawTransaction")));
    assert(r.posts.filter(row => row.methods.includes("debug_traceTransaction")).length <= 1);
  });
}

test("Linea archive trace preserves exact native amount binding", async () => {
  const r = reader();
  await assert.rejects(r.rpc.observeDestination!(capture.transactionHash, { ...capture.expected,
    amountAtomic: (BigInt(capture.expected.amountAtomic) + 1n).toString() }), { code: "APN_RPC_PROTOCOL" });
});

for (const limits of [{ maxHttpRequests: 1 }, { deadlineMs: 1 }]) test("Linea archive trace cannot escape command read limits or original deadline", async () => {
  const r = reader(undefined, limits);
  await assert.rejects(r.rpc.observeDestination!(capture.transactionHash, capture.expected));
  assert(r.posts.length <= 1);
  assert.equal(r.session.telemetry().deadline, r.epoch + (limits.deadlineMs ?? 60_000));
});


test("Linea observation still refuses proof with a changed frozen primary RPC origin", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-linea");
  s.provider.statusValue = "completed_observed";
  const observe = s.destination.observe.bind(s.destination);
  s.destination.observe = async (...args) => {
    const proof = await observe(...args);
    return proof === null ? null : { ...proof, transaction: { ...proof.transaction, rpcOrigin: "https://rpc.linea.build" } };
  };
  const { id } = await s.prepare("across", "linea-frozen-primary-origin-001");
  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true);
  const record = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(record.state, "unknown_finality");
  assert.equal(record.destinationProof, null);
  assert.equal(s.source.submissions.length, 1);
});
