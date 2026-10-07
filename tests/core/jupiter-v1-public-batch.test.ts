import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SolanaRpc, SolanaRpcBudget, type SolanaBatchRead, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { JupiterV1BudgetedRpc } from "../../src/swap/jupiter-solana/v1-execution.js";
import { JupiterV1MaterialResolver } from "../../src/swap/jupiter-solana/v1-resolver.js";
import { liveSimulationCapture } from "../fixtures/jupiter-v1-live-simulation-83/capture.js";
import { temporaryState } from "./helpers.js";
const m = liveSimulationCapture().material;
function publicPort(batched: boolean, change?: (key: string, data: Buffer) => void) {
 const reads: SolanaBatchRead[] = [], grouped: SolanaBatchRead[][] = [];
 const wire = (key: string, slice?: {offset: number; length: number}) => {
  const a = m.semanticAccounts.find(a => a.address === key);
  if (a === undefined || a.existence === "absent") return null;
  const data = Buffer.from(a.dataBase64, "base64"); change?.(key, data);
  return {owner: a.owner, executable: a.executable, lamports: BigInt(a.lamports), space: data.length, rentEpoch: 0n,
   data: [(slice === undefined ? data : data.subarray(slice.offset, slice.offset + slice.length)).toString("base64"), "base64"]};
 };
 const call: SolanaRpcPort["call"] = async (method, params) => {
  reads.push({method: method as SolanaBatchRead["method"], params});
  const config = params[1] as {dataSlice?: {offset: number; length: number}} | undefined;
  switch (method) {
   case "getGenesisHash": return m.genesis;
   case "getMultipleAccounts": return {context: {slot: BigInt(m.accountSlot)}, value: (params[0] as string[]).map(k => wire(k, config?.dataSlice))};
   case "getAccountInfo": return {context: {slot: BigInt(m.accountSlot)}, value: wire(params[0] as string, config?.dataSlice)};
   case "getFeeForMessage": assert.equal(params[0], m.messageBase64); return {context: {slot: BigInt(m.accountSlot)}, value: 6400n};
   case "getBlockHeight": return 1n;
   case "getMinimumBalanceForRentExemption": return 1488440n;
   default: throw Error(`No financial or simulation method allowed: ${method}`);
  }
 };
 const rpc: SolanaRpcPort = {originHash: "0".repeat(64), call, ...(batched ? {batch: async (r: readonly SolanaBatchRead[]) => {
  grouped.push([...r]); return await Promise.all(r.map(v => call(v.method, v.params)));
 }} : {})};
 return {rpc, reads, batches: grouped};
}
test("batched public resolution retains the complete frozen message and full executable byte proof", async () => {
 const ordinary = publicPort(false), batched = publicPort(true);
 const a = await new JupiterV1MaterialResolver(ordinary.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse);
 const b = await new JupiterV1MaterialResolver(batched.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse);
 assert.deepEqual(b, a); assert.equal(b.messageHash, m.messageHash);
 assert.deepEqual(b.programPins, m.programPins);
 assert.equal(batched.reads.length, ordinary.reads.length);
 assert.equal(batched.batches.length, 3);
 assert.ok(batched.batches.every(r => r.length >= 2 && r.length <= 8));
 for (const pin of b.programPins.filter(p => p.programDataAddress !== null)) {
  const original = m.semanticAccounts.find(a => a.address === pin.programDataAddress)!;
  const resolved = b.semanticAccounts.find(a => a.address === pin.programDataAddress)!;
  assert.equal(resolved.dataBase64, original.dataBase64);
 }
});
test("batched public proof still refuses a changed deployed executable payload", async () => {
 const p = publicPort(true, (key, bytes) => {if (key === m.programPins.find(p => p.programDataAddress !== null)!.programDataAddress) bytes[45] = bytes[45]! ^ 1;});
 await assert.rejects(new JupiterV1MaterialResolver(p.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse), /runtime executable pin changed/);
 assert.equal(p.reads.some(r => r.method === "getFeeForMessage"), false);
});
test("an incomplete public batch refuses before any executable chunk or fee proof", async () => {
 const p = publicPort(true); p.rpc.batch = async () => [];
 await assert.rejects(new JupiterV1MaterialResolver(p.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse), /batch is incomplete/);
 assert.deepEqual(p.reads.map(r => r.method), ["getGenesisHash"]);
});
const small: readonly SolanaBatchRead[] = [{method: "getBlockHeight", params: []}, {method: "getMinimumBalanceForRentExemption", params: [165]}];
test("one physical POST retains two durable Jupiter logical charges and base budget charges", async t => {
 const temp = await temporaryState(); t.after(temp.cleanup); let posts = 0;
 const budget = new SolanaRpcBudget({maxPhysicalRequests: 1});
 const base = new SolanaRpc("https://rpc.example", async (_url, init) => {
  posts++; const requests = JSON.parse(String(init?.body)); assert.equal(requests.length, 2);
  return new Response(JSON.stringify(requests.map((q: any, i: number) => ({jsonrpc: "2.0", id: q.id, result: i + 1})).reverse()), {headers: {"content-type": "application/json"}});
 }, budget);
 const rpc = new JupiterV1BudgetedRpc(base, temp.root, "quote");
 assert.deepEqual(await rpc.batch(small), [1n, 2n]); await rpc.bindQuote("a".repeat(64));
 const quote = JSON.parse(await readFile(join(temp.root, "jupiter-v1-budget-quotes", `${"a".repeat(64)}.json`), "utf8"));
 assert.equal(quote.calls, 2); assert.equal(posts, 1); assert.equal(budget.physicalRequests, 1); assert.equal(budget.logicalCalls, 2);
});
test("a batch crossing the durable 64-call boundary refuses before transport", async t => {
 const temp = await temporaryState(); t.after(temp.cleanup); let posts = 0;
 const rpc = new JupiterV1BudgetedRpc(new SolanaRpc("https://rpc.example", async () => {posts++; throw Error("forbidden");}), temp.root, "quote");
 for (let i = 0; i < 63; i++) await rpc.chargeOfficialRead();
 await assert.rejects(rpc.batch(small), /cap was exhausted/); assert.equal(posts, 0);
 await assert.rejects(rpc.call("getBlockHeight", []), /cap was exhausted/); assert.equal(posts, 0);
});
test("Jupiter cannot batch a financial send into the public transport", async t => {
 const temp = await temporaryState(); t.after(temp.cleanup); let posts = 0;
 const rpc = new JupiterV1BudgetedRpc(new SolanaRpc("https://rpc.example", async () => {posts++; throw Error("forbidden");}), temp.root, "quote");
 await assert.rejects(rpc.batch([{method: "sendTransaction", params: []}] as any)); assert.equal(posts, 0);
});
