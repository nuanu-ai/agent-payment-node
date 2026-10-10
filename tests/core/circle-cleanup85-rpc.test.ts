import assert from "node:assert/strict";
import test from "node:test";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import { ApnError } from "../../src/errors.js";
const hash = "0x" + "a".repeat(64) as `0x${string}`;
for (const status of [429, 500, 502, 503, 504, 400, 401, 403]) test(`Circle read-only HTTP${status} retry is finite`, async () => {
  let calls = 0;
  const rpc = new CircleRpc("https://example.org", 42161, { request: async (_url, _method, body) => { const input = JSON.parse(body!); calls++; return calls === 1 ? { status, body: "untrusted response excluded" } : { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: input.id, result: "0xa4b1" }) }; } });
  if (status === 400 || status === 401 || status === 403) { await assert.rejects(rpc.identity(), e => e instanceof ApnError && e.details?.status === status && e.details.method === "eth_chainId"); assert.equal(calls, 1); }
  else { await rpc.identity(); assert.equal(calls, 2); }
});
test("Circle physical read retry accounts against unchanged request budget", async () => {
  let calls = 0; const rpc = new CircleRpc("https://example.org", 42161, { request: async () => { calls++; return { status: 503, body: "" }; } }, 1);
  await assert.rejects(rpc.identity(), /rpc_method_or_budget/); assert.equal(calls, 1);
});
test("Circle sendRawTransaction never retries and preserves sanitized first HTTP metadata", async () => {
  let calls = 0; const rpc = new CircleRpc("https://example.org", 42161, { request: async () => { calls++; return { status: 503, body: "private signed body excluded" }; } });
  await assert.rejects(rpc.call("eth_sendRawTransaction", ["not-printed"], () => {}), e => e instanceof ApnError && e.details?.method === "eth_sendRawTransaction" && e.details.origin === "https://example.org" && e.details.status === 503 && !JSON.stringify(e.details).includes("not-printed")); assert.equal(calls, 1);
});
test("Circle interrupted anchored observation repeats full identity/transaction/receipt, never stitches", async () => {
  let transactions = 0, receipts = 0, identities = 0;
  const rpc = new CircleRpc("https://example.org", 42161, { request: async (_url, _method, body) => {
    const input = JSON.parse(body!); let result: unknown;
    if (input.method === "eth_chainId") { identities++; result = "0xa4b1"; }
    else if (input.method === "eth_getTransactionByHash") { transactions++; result = { marker: transactions }; }
    else if (input.method === "eth_getTransactionReceipt") { receipts++; if (receipts === 1) return { status: 503, body: "" }; result = { blockNumber: "0xa", blockHash: hash }; }
    else result = { number: "0xa", hash };
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: input.id, result }) };
  } });
  const result = await rpc.observation(hash, "finalized"); assert.equal((result!.transaction as { marker: number }).marker, 2); assert.equal(transactions, 2); assert.equal(receipts, 2); assert.equal(identities, 2);
});
test("Circle fresh guard expires after queued TLS gate before request body", async () => {
  let expired = false, bodies = 0;
  const rpc = new CircleRpc("https://example.org", 42161, { request: async (_url, _method, _body, _max, _code, beforeSend) => { expired = true; beforeSend?.(); bodies++; return { status: 503, body: "" }; } });
  await assert.rejects(rpc.guarded(() => { if (expired) throw new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "expired"); }, () => rpc.call("eth_sendRawTransaction", ["not-printed"], () => {})), /transport failed/); assert.equal(bodies, 0);
});
