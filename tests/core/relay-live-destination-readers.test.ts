import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RelayBnbReadOnlyRpc } from "../../src/relay/observe-rpc.js";
import { BATCH_READ_METHODS, readOnlyBatchMethod } from "../../src/rpc-envelope.js";
const dir = "tests/core/relay-fixtures/live-destination-20261009/";
const fixture = async (name: string): Promise<any> => JSON.parse(await readFile(dir + name + ".json", "utf8"));
const result = (rows: any[], id: number) => rows.find(row => row.id === id).result;
async function polygon() {
  const captured = await fixture("polygon-drpc-canonical"), trace = result(await fixture("polygon-drpc-trace"), 2), balances = await fixture("polygon-drpc-balances");
  const tx = result(captured, 3), block = result(captured, 1), parent = result(captured, 2);
  return { trace, tx, block, parent, full: (await fixture("polygon-drpc-fullblock")).result,
    before: BigInt(result(balances, 1)), after: BigInt(result(balances, 2)) };
}
for (const mega of [true, false]) test(`full live ${mega ? "USDm" : "POL"} reader proves credit from the real receipt in two POSTs and rejects wrong chain/unsafe receipt`, async () => {
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
  const p = await polygon(), mh = await fixture("mega-token-headers-public"), mf = await fixture("mega-finality-public");
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
      if (c.method === "eth_getBlockByNumber") {
        if (["safe", "finalized"].includes(c.params[0])) return unsafe ? previous : safe;
        if (c.params[0] === previous.number) return previous;
        if (c.params[0] === safe.number) return safe;
        return c.params[1] ? p.full : included;
      }
      throw Error(c.method);
    }) };
    let posts = 0; const guard = { get physicalRequests() { return posts; }, post: async (_u: string, fn: () => Promise<any>) => { assert(++posts <= 2); return fn(); } };
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
