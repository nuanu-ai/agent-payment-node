import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { temporaryState } from "./helpers.js";
import { lifiFixture } from "./lifi-helpers.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { bridgeRpcFactory, BridgeRpcPhysicalBudget, RpcReadSession } from "../../src/lifi/rpc.js";

const raw = await readFile("tests/core/lifi-fixtures/linea-native-fill-rpc-20260920.json", "utf8");
assert.equal(sha256(raw), "ecc7d70307afd5d529965c5f37139df5380958408b28524b9e089917b1900b04");
const capture = JSON.parse(raw);
const deploymentRaw = await readFile("tests/core/lifi-fixtures/deployment-linea-rpc-20260921.json","utf8");
assert.equal(sha256(deploymentRaw),"d8a3fec0312a4ef503036ef3be18052e729ad2890bff2c48fb4d5e9dab173d0c");
const deploymentCapture=JSON.parse(deploymentRaw);
const traceOptions = { tracer: "callTracer", tracerConfig: { onlyTopCall: false, withLog: false } };
const identity = (method: string, params: readonly unknown[]) => canonicalJson([method, params]);
type Mutation = "chain" | "error" | "missing" | "malformed" | "large" | "trace" | "receipt" | "canonical" | "reanchor";

function reader(mutation?: Mutation, limits: { maxHttpRequests?: number; deadlineMs?: number } = {}) {
  const values = new Map<string, unknown>(capture.requests.map((row: any) =>
    [identity(row.request.method, row.request.params), row.response.result]));
  // TEST composite graph: immutable captured deployment values re-pinned to the fixture's
  // canonical included header, solely to exercise the normal exact-hash deployment read graph.
  for (const row of deploymentCapture.requests) {
    const params = structuredClone(row.request.params), index = ({eth_getCode:1,eth_call:1,eth_getStorageAt:2} as Record<string,number>)[row.request.method];
    if (index !== undefined) params[index] = {blockHash:capture.receiptBlock.hash,requireCanonical:true};
    const key=identity(row.request.method,params);if(!values.has(key))values.set(key,row.response.result);
  }
  let now = Date.parse(capture.capturedAt);
  const epoch = now, wait = async (milliseconds: number) => { await new Promise<void>((resolve) => setImmediate(resolve)); now += milliseconds; };
  const physical = new BridgeRpcPhysicalBudget(24);
  const session = new RpcReadSession({ now: () => now, wait, physicalBudget: physical, maxReadAttempts: 1,
    archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 16, maxHttpAttempts: 16, deadlineMs: 180_000, ...limits });
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
            if (request.params[0] === capture.transactionHash) assert.deepEqual(request.params, [capture.transactionHash, traceOptions]);
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
          if (mutation === "reanchor" && role === "primary" && posts.some(row => row.role === "archive" && row.methods.includes("debug_traceTransaction")) && request.method === "eth_getBlockByNumber" && request.params[0] === capture.receiptBlock.number) result.hash = `0x${"ff".repeat(32)}`;
          return { jsonrpc: "2.0", id: request.id, result };
        });
        return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
      },
    } })(59144, session);
  return { rpc, session, posts, epoch, physical };
}

test("Linea native fill reads its trace and pinned balances from the named archive, everything else from the primary", async (t) => {
  const r = reader(), observed = await r.rpc.observeDestination!(capture.transactionHash, capture.expected);
  assert(observed);
  assert.equal(observed.transaction.rpcOrigin, "https://linea-rpc.publicnode.com");
  assert.equal(observed.receipt.nativeTransfer?.valueAtomic, capture.expected.amountAtomic);
  assert.equal(observed.receipt.nativeTransfer?.to, capture.expected.recipient);
  assert.deepEqual(r.posts.filter(row => row.methods.includes("debug_traceTransaction")).map(row => ({ role: row.role, methods: row.methods })),
    [{ role: "archive", methods: ["debug_traceTransaction"] }]);
  const telemetry = r.session.telemetry();
  assert.equal(telemetry.batchItemsByMethod.debug_traceTransaction, 1);
  assert.equal(telemetry.deadline, r.epoch + 180_000);
  // Primary: [chain, transaction, receipt, safe head], inclusion header, pre-delivery header. Archive: chain identity once,
  // two hash-pinned balances, the trace. No header recheck after hash-pinned reads.
  assert.deepEqual(r.posts.map(row => row.role), ["primary", "primary", "primary", "archive", "archive", "archive", "archive"]);
  assert.equal(r.physical.remaining(), 24 - 7);
  assert.equal(telemetry.httpRequests, r.posts.length); assert.equal(telemetry.httpAttempts, r.posts.length);
  t.diagnostic(JSON.stringify({ posts: r.posts, telemetry }));
  assert.equal(r.posts.filter(row => row.methods.includes("eth_getBalance")).length, 2);
  assert(r.posts.filter(row => row.methods.includes("eth_getBalance")).every(row => row.role === "archive"));
  // Pacing belongs to each provider family: consecutive POSTs to one endpoint keep their 750 ms gap.
  for (const role of ["primary", "archive"]) {
    const own = r.posts.filter(row => row.role === role);
    for (let index = 1; index < own.length; index++) assert(own[index]!.at - own[index - 1]!.at >= 750, role);
  }
});

// Hash-pinned reads need no header recheck after the trace (P2): the node enforces `requireCanonical` itself.
for (const mutation of ["chain", "error", "missing", "malformed", "large", "trace", "receipt", "canonical"] as const) {
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
  assert.equal(r.session.telemetry().deadline, r.epoch + (limits.deadlineMs ?? 180_000));
});


// LIFI-06: the operation binds the chain, not the endpoint URL frozen at prepare; another endpoint of Linea proves the same delivery.
test("Linea observation accepts proof read through another primary RPC endpoint of the same chain", async (t) => {
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
  assert.equal(record.state, "completed");
  assert.equal(record.destinationProof?.rpcOrigin, s.destination.origin);
  assert.equal(s.source.submissions.length, 1);
});


test("the frozen migration proof still reproduces the captured Linea deployment identity without a trace probe", async () => {
  const r = reader(), observed = await r.rpc.observeDestination!(capture.transactionHash, capture.expected); assert(observed);
  const before = r.posts.length;
  const deployment = await r.rpc.deployment("across", 1, BRIDGE_ZERO_ADDRESS, observed.transaction.block, true);
  assert.deepEqual(deployment.block, observed.transaction.block); assert.equal(deployment.rpcOrigin, "https://linea-rpc.publicnode.com");
  assert.equal(deployment.codeHash, deploymentCapture.proof.codeHash); assert.equal(deployment.configurationHash, deploymentCapture.proof.configurationHash);
  assert(r.posts.slice(before).every(row => row.role === "archive" && !row.methods.includes("debug_traceTransaction")));
});
