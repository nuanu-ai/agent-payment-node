import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RelayBnbReadOnlyRpc } from "../../src/relay/observe-rpc.js";
import { decodePolygonPayoutTrace } from "../../src/relay/polygon-trace.js";
import { BATCH_READ_METHODS, readOnlyBatchMethod } from "../../src/rpc-envelope.js";
import { MERCHANT_PROXY_HASH, MERCHANT_IMPLEMENTATION, MERCHANT_IMPLEMENTATION_HASH } from "../../src/x402-merchant/pins.js";
const dir = "tests/core/relay-fixtures/live-destination-20261009/";
const fixture = async (name: string): Promise<any> => JSON.parse(await readFile(dir + name + ".json", "utf8"));
const result = (rows: any[], id: number) => rows.find(row => row.id === id).result;
const clone = (value: any) => structuredClone(value);
async function polygon() {
  const captured = await fixture("polygon-drpc-canonical"), trace = result(await fixture("polygon-drpc-trace"), 2), balances = await fixture("polygon-drpc-balances");
  const tx = result(captured, 3), block = result(captured, 1), parent = result(captured, 2);
  return { trace, tx, block, parent, full: (await fixture("polygon-drpc-fullblock")).result,
    before: BigInt(result(balances, 1)), after: BigInt(result(balances, 2)) };
}
function credit(node: any): any { if (node.to === "0x823a3a5bab1186141b32fc65f8e25ca24c679ce7") return node;
  for (const child of node.calls ?? []) { const found = credit(child); if (found) return found; } }
test("full untouched real Polygon callTracer binds exact payout and EIP1898 balance delta", async () => {
  const f = await polygon(), decoded = decodePolygonPayoutTrace(f.trace, f.tx, f.tx.hash, f.block.hash, f.before, f.after);
  assert.equal(f.after - f.before, BigInt("0xb6e922eb7e892e4"));
  assert.equal(decoded.transfers.filter(t => t.to.toLowerCase() === credit(f.trace).to).length, 1);
  assert.equal(decoded.complete, true); assert.equal(decoded.revertedCallsExcluded, true);
});
for (const mutation of ["hash", "chain", "receiver", "revert", "duplicate", "truncated", "unsupported", "root-input", "negative-delta"] as const)
  test(`real trace refuses ${mutation}`, async () => {
    const f = await polygon(), t = clone(f.trace), tx = clone(f.tx); let after = f.after;
    if (mutation === "hash") tx.hash = `0x${"1".repeat(64)}`;
    if (mutation === "chain") tx.chainId = "0x38";
    if (mutation === "receiver") credit(t).to = "0x1111111111111111111111111111111111111111";
    if (mutation === "revert") credit(t).error = "execution reverted";
    if (mutation === "duplicate") { const c = credit(t); const parent = t.calls.find((n: any) => credit(n)); parent.calls.push(clone(c)); }
    if (mutation === "truncated") delete t.calls;
    if (mutation === "unsupported") t.calls[0].type = "SELFDESTRUCT";
    if (mutation === "root-input") t.input = "0x";
    if (mutation === "negative-delta") after = f.before - 1n;
    assert.throws(() => decodePolygonPayoutTrace(t, tx, f.tx.hash, f.block.hash, f.before, after));
  });
test("finite Polygon adapter proves full real trace, parent membership and canonical state; legacy trace stays null", async () => {
  const f = await polygon(); let posts = 0, wrongParent = false, wrongBalance = false, wrongMembership = false;
  const rpc = { batchCall: async (calls: any[]) => calls.map(c => {
    assert(BATCH_READ_METHODS.has(c.method));
    if (c.method === "eth_getTransactionByHash") return f.tx;
    if (c.method === "debug_traceTransaction") { assert.deepEqual(c.params, [f.tx.hash, { tracer: "callTracer", timeout: "10s" }]); return f.trace; }
    if (c.method === "eth_getBlockByNumber") {
      if (c.params[0] === f.parent.number) return wrongParent ? { ...f.parent, hash: `0x${"1".repeat(64)}` } : f.parent;
      if (c.params[1]) return wrongMembership ? { ...f.full, transactions: [] } : f.full;
      return f.block;
    }
    if (c.method === "eth_getBalance") { assert.equal(c.params[1].requireCanonical, true);
      return `0x${(c.params[1].blockHash === f.parent.hash ? f.before : f.after + (wrongBalance ? 1n : 0n)).toString(16)}`; }
    throw Error(c.method);
  }) };
  const guard = { get physicalRequests() { return posts; }, post: async (_url: string, fn: () => Promise<any>) => { posts++; return fn(); } };
  const adapter = new RelayBnbReadOnlyRpc("https://polygon.drpc.org", {} as any, rpc as any, guard as any, 137);
  assert.equal(await adapter.nativeTrace(), null); await adapter.transaction(f.tx.hash);
  assert.equal((await adapter.polygonNativeTrace(f.tx.hash)).transactionHash, f.tx.hash);
  wrongParent = true; await assert.rejects(adapter.polygonNativeTrace(f.tx.hash)); wrongParent = false;
  wrongBalance = true; await assert.rejects(adapter.polygonNativeTrace(f.tx.hash)); wrongBalance = false;
  wrongMembership = true; await assert.rejects(adapter.polygonNativeTrace(f.tx.hash));
});
test("Mega real fixed USDm state reader admits storage read and binds canonical parent/block/pins", async () => {
  const h = await fixture("mega-token-headers-public"), values = await fixture("mega-token-eip1898-public");
  const block = result(h, 3), parent = result(h, 2); let changed = false, posts = 0;
  const rpc = { batchCall: async (calls: any[]) => calls.map(c => {
    assert(BATCH_READ_METHODS.has(c.method));
    if (c.method === "eth_getBlockByNumber") return c.params[0] === parent.number ? parent : changed ? { ...block, hash: `0x${"1".repeat(64)}` } : block;
    assert.equal(c.params.at(-1).requireCanonical, true);
    if (c.method === "eth_getStorageAt") return result(values, 2);
    if (c.method === "eth_getCode") return result(values, c.params[0].toLowerCase() === MERCHANT_IMPLEMENTATION.toLowerCase() ? 5 : 1);
    if (c.method === "eth_call") return result(values, c.params[1].blockHash === parent.hash ? 3 : 4);
    throw Error(c.method);
  }) };
  const guard = { get physicalRequests() { return posts; }, post: async (_url: string, fn: () => Promise<any>) => { posts++; return fn(); } };
  const adapter = new RelayBnbReadOnlyRpc("https://mainnet.megaeth.com/rpc", {} as any, rpc as any, guard as any, 4326);
  const state = await adapter.tokenIdentityAndBalances("0xfafddbb3fc7688494971a79cc65dca3ef82079e7", "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14", BigInt(block.number), block.hash);
  assert.equal(posts, 3); assert.equal(state.proxyHash, MERCHANT_PROXY_HASH); assert.equal(state.implementation.toLowerCase(), MERCHANT_IMPLEMENTATION.toLowerCase());
  assert.equal(state.implementationHash, MERCHANT_IMPLEMENTATION_HASH); assert.equal(state.before, 0n); assert.equal(state.after, 104059972707704120n);
  changed = true; await assert.rejects(adapter.tokenIdentityAndBalances("0xfafddbb3fc7688494971a79cc65dca3ef82079e7", "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14", BigInt(block.number), block.hash));
  assert(!BATCH_READ_METHODS.has("eth_sendRawTransaction"));
});
for (const mega of [true, false]) test(`full live ${mega ? "USDm" : "POL"} reader reaches canonical credit and rejects wrong chain/unsafe receipt`, async () => {
  const { validateRelayNativeQuote, RELAY_BASE_SOURCE, RELAY_POLYGON_RECIPIENT, RELAY_BNB_SOURCE } = await import("../../src/relay/native-quote.js");
  const { freezeRelayUnsignedOperation } = await import("../../src/relay-unsigned-operation.js");
  const { proveRelayNativeDestination } = await import("../../src/relay/destination-proof.js");
  const q = await validateRelayNativeQuote(JSON.parse(await readFile(`tests/core/relay-fixtures/relay-base-${mega ? "mega-usdm" : "polygon-pol"}-quote-20261009.json`, "utf8")),
    { payer: RELAY_BASE_SOURCE, recipient: mega ? RELAY_POLYGON_RECIPIENT : RELAY_BNB_SOURCE, amountAtomic: "50000000000000", minimumOutputWei: mega ? "90000000000000000" : "700000000000000000", nowSeconds: 1791517419 });
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned", state: "prepared", terminal: false,
    profileHash: "1".repeat(64), operationId: "2".repeat(64), idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 8453, destinationChainId: mega ? 4326 : 137,
    sourceAccount: q.payer, recipient: q.recipient, quoteDigest: q.quoteDigest, nativeQuote: q, statusLocator: q.statusLocator!, policyDigest: "5".repeat(64), policyRevision: 7, policyActivationDigest: "a".repeat(64),
    depositNetworkFeeCeilingWei: q.deposit.maximumNetworkFeeWei, amountAtomic: q.principalAtomic, minOutputAtomic: q.minimumOutputWei,
    createdAt: new Date(1791517419000).toISOString(), deadline: new Date(q.deadline * 1000).toISOString() });
  const p = await polygon(), mh = await fixture("mega-token-headers-public"), mv = await fixture("mega-token-eip1898-public"), mf = await fixture("mega-finality-public");
  const included = mega ? result(mh, 3) : p.block, previous = mega ? result(mh, 2) : p.parent;
  const tx = mega ? result(mf, 1) : p.tx, receipt = mega ? result(await fixture("mega-public-receipt-safe"), 2) : result(await fixture("polygon-drpc-canonical"), 4);
  const safe = mega ? result(mf, 2) : result(await fixture("polygon-drpc-trace"), 3);
  let chainWrong = false, unsafe = false;
  function adapter() {
    const rpc = { batchCall: async (calls: any[]) => calls.map(c => {
      assert(BATCH_READ_METHODS.has(c.method));
      if (c.method === "eth_chainId") return chainWrong ? "0x38" : mega ? "0x10e6" : "0x89";
      if (c.method === "eth_getTransactionByHash") return tx;
      if (c.method === "eth_getTransactionReceipt") return receipt;
      if (c.method === "debug_traceTransaction") return p.trace;
      if (c.method === "eth_getBlockByNumber") {
        if (["safe", "finalized"].includes(c.params[0])) return unsafe ? previous : safe;
        if (c.params[0] === previous.number) return previous;
        if (c.params[0] === safe.number) return safe;
        return c.params[1] ? p.full : included;
      }
      assert.equal(c.params.at(-1).requireCanonical, true);
      if (c.method === "eth_getStorageAt") return result(mv, 2);
      if (c.method === "eth_getCode") return result(mv, c.params[0].toLowerCase() === MERCHANT_IMPLEMENTATION.toLowerCase() ? 5 : 1);
      if (c.method === "eth_call") return result(mv, c.params[1].blockHash === previous.hash ? 3 : 4);
      if (c.method === "eth_getBalance") return `0x${(c.params[1].blockHash === previous.hash ? p.before : p.after).toString(16)}`;
      throw Error(c.method);
    }) };
    let posts = 0; const guard = { get physicalRequests() { return posts; }, post: async (_u: string, fn: () => Promise<any>) => { assert(++posts <= 10); return fn(); } };
    return new RelayBnbReadOnlyRpc("https://polygon.drpc.org", {} as any, rpc as any, guard as any, mega ? 4326 : 137);
  }
  const proof = await proveRelayNativeDestination(op, `0x${"a".repeat(64)}`, [tx.hash], adapter());
  assert.equal(proof.status, "recipient_credit_proven"); assert.equal(proof.relayOrderFulfillmentProven, false);
  if (proof.status === "recipient_credit_proven") assert.equal(proof.proof.creditedWei, mega ? "104059972707704120" : (p.after - p.before).toString());
  chainWrong = true; assert.equal((await proveRelayNativeDestination(op, `0x${"a".repeat(64)}`, [tx.hash], adapter())).status, "mismatch");
  chainWrong = false; unsafe = true; assert.equal((await proveRelayNativeDestination(op, `0x${"a".repeat(64)}`, [tx.hash], adapter())).status, "pending");
});

test("trace batch admission permits only the fixed exhaustive callTracer, never custom code or arbitrary config", () => {
  const hash = `0x${"a".repeat(64)}`;
  assert(readOnlyBatchMethod("debug_traceTransaction", [hash, { tracer: "callTracer", timeout: "10s" }]));
  for (const config of [{ tracer: "callTracer", timeout: "10s", onlyTopCall: true }, { tracer: "{fault:function(){},result:function(){}}", timeout: "10s" }, { tracer: "callTracer", timeout: "1h" }])
    assert(!readOnlyBatchMethod("debug_traceTransaction", [hash, config]));
  assert(!readOnlyBatchMethod("debug_traceTransaction", ["0x01", { tracer: "callTracer", timeout: "10s" }]));
  assert(!readOnlyBatchMethod("eth_sendRawTransaction", ["0x"]));
});
