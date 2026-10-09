import assert from "node:assert/strict";
import test from "node:test";
import { HistoricalPaidRpc } from "../../src/circle-v2-evm/historical-paid-rpc.js";
import { CircleExternalRpcBudget } from "../../src/circle-v2-evm/external-rpc.js";
import { HISTORICAL_LINEA_OPERATION } from "../../src/circle-v2-evm/historical-paid-source.js";
const hash = "0x" + "1".repeat(64), selector = () => ({ blockHash: hash, requireCanonical: true }), endpoint = "https://rpc.linea.build";
function fixture(reply?: (q: { method: string; params: unknown[] }) => Promise<string> | string) { let now = 1; const calls: { url: string; method: string; params: unknown[] }[] = [], transport = { request: async (url: string, _method: string, body: string | null) => { const q = JSON.parse(body!); calls.push({ url, method: q.method, params: q.params }); const result = await (reply?.(q) ?? "0x1234"); return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }) }; } }, budget = new CircleExternalRpcBudget(() => now, 1000, transport as never); return { calls, budget, rpc: new HistoricalPaidRpc(endpoint, 59144, budget, HISTORICAL_LINEA_OPERATION), expire: () => { now = 1000; } }; }
test("ephemeral canonical HEX cache isolates endpoint/method/full params/hash and every new invocation", async () => {
  const f = fixture(); const p = [{ to: "0x" + "1".repeat(40), from: "0x" + "2".repeat(40), data: "0x1234" }, selector()]; await f.rpc.call("eth_call", p); await f.rpc.call("eth_call", p); assert.equal(f.calls.length, 1);
  for (const next of [[{ ...p[0], data: "0xabcd" }, selector()], [{ ...p[0], from: "0x" + "3".repeat(40) }, selector()], [p[0], { blockHash: "0x" + "2".repeat(64), requireCanonical: true }]]) await f.rpc.call("eth_call", next);
  await f.rpc.call("eth_getCode", ["0x" + "1".repeat(40), selector()]); await f.rpc.call("eth_getStorageAt", ["0x" + "1".repeat(40), "0x" + "0".repeat(64), selector()]);
  await new HistoricalPaidRpc("https://linea-rpc.publicnode.com", 59144, f.budget, HISTORICAL_LINEA_OPERATION).call("eth_call", p); await new HistoricalPaidRpc(endpoint, 59144, f.budget, HISTORICAL_LINEA_OPERATION).call("eth_call", p); assert.equal(f.calls.length, 8); assert.equal(f.rpc.counts().hits, 1);
  f.expire(); await assert.rejects(f.rpc.call("eth_call", p), /deadline/); assert.equal(f.calls.length, 8);
});
test("noncanonical/latest/number/head/nonce and invalid success/error results are never cached", async () => {
  let fail = true; const f = fixture(q => { if (q.params[0] === "error" && fail) { fail = false; throw Error("transport"); } return q.params[0] === "bad" ? "nothex" : "0x1234"; });
  for (const tag of ["latest", "0x123", { blockHash: hash, requireCanonical: false }, { blockHash: "0x" + "0".repeat(64), requireCanonical: true }, { blockHash: hash, requireCanonical: true, extra: 1 }]) for (let i = 0; i < 2; i++) await f.rpc.call("eth_getCode", ["target", tag]);
  for (let i = 0; i < 2; i++) { await f.rpc.call("eth_getCode", ["bad", selector()]); await f.rpc.call("eth_getBlockByNumber", ["finalized", false]); await f.rpc.call("eth_getTransactionCount", ["owner", selector()]); }
  await assert.rejects(f.rpc.call("eth_getCode", ["error", selector()]), /transport/); await f.rpc.call("eth_getCode", ["error", selector()]); assert.equal(f.rpc.counts().hits, 0); assert.equal(f.calls.length, 18);
  await assert.rejects(f.rpc.call("eth_sendRawTransaction", ["0x12"]), /method/);
});
test("async params aliases cannot poison the pinned cache key or physical request", async () => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }), f = fixture(async () => { await gate; return "0x1234"; }), params = [{ to: "first", data: "0x12" }, selector()];
  const first = f.rpc.call("eth_call", params); (params[0] as { to: string }).to = "second"; (params[1] as { blockHash: string }).blockHash = "0x" + "2".repeat(64); release(); await first;
  await f.rpc.call("eth_call", [{ to: "first", data: "0x12" }, selector()]); assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.params[0] && (f.calls[0]!.params[0] as { to: string }).to, "first"); await f.rpc.call("eth_call", params); assert.equal(f.calls.length, 2);
});
