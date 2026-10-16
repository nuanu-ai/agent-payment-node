import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { SolanaRpc, SolanaRpcBudget, type SolanaBatchRead, type SolanaMethod, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { canonicalJson } from "../../src/canonical.js";
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
const programData = () => m.programPins.filter(p => p.programDataAddress !== null).map(p => p.programDataAddress!);
test("batched public resolution retains the complete frozen message and reads every program as a 45-byte header", async () => {
 const ordinary = publicPort(false), batched = publicPort(true);
 const a = await new JupiterV1MaterialResolver(ordinary.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports);
 const b = await new JupiterV1MaterialResolver(batched.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports);
 assert.deepEqual(b, a); assert.equal(b.messageHash, m.messageHash);
 assert.ok(b.programPins.every(p => p.provenance === "upgrade_authority"));
 assert.equal(batched.reads.length, ordinary.reads.length);
 assert.ok(batched.batches.every(r => r.length >= 2 && r.length <= 8));
 const headers = ordinary.reads.filter(r => (r.params[1] as { dataSlice?: unknown } | undefined)?.dataSlice !== undefined);
 // Nine program and ProgramData keys (no Memo on this route): an eight-key and a one-key request, both 45-byte slices.
 assert.deepEqual(headers.map(r => (r.params[0] as string[]).length), [8, 1]);
 assert.ok(headers.every(r => canonicalJson((r.params[1] as { dataSlice: unknown }).dataSlice) === canonicalJson({ offset: 0, length: 45 })));
 for (const address of programData()) {
  const original = Buffer.from(m.semanticAccounts.find(a => a.address === address)!.dataBase64, "base64");
  assert.equal(b.semanticAccounts.find(a => a.address === address)!.dataBase64, original.subarray(0, 45).toString("base64"));
 }
});
test("every account read sends at most eight keys, whatever the endpoint, and preserves the frozen message", async () => {
 const ordinary = publicPort(false), batched = publicPort(true);
 const a = await new JupiterV1MaterialResolver(ordinary.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports);
 const b = await new JupiterV1MaterialResolver(batched.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports);
 assert.deepEqual(b, a); assert.equal(b.messageHash, m.messageHash);
 const accountReads = ordinary.reads.filter(r => r.method === "getMultipleAccounts");
 assert.ok(accountReads.length >= 2 && accountReads.every(r => (r.params[0] as string[]).length <= 8));
 assert.ok(accountReads.every(r => (r.params[1] as { minContextSlot?: number }).minContextSlot === m.quoteResponse.contextSlot));
});
test("public resolution never downloads ProgramData beyond its header", async () => {
 const p = publicPort(false); await new JupiterV1MaterialResolver(p.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports);
 assert.equal(p.reads.some(r => r.method === "getAccountInfo"), false);
 for (const read of p.reads.filter(r => r.method === "getMultipleAccounts" && (r.params[0] as string[]).some(k => programData().includes(k))))
  assert.deepEqual((read.params[1] as { dataSlice?: unknown }).dataSlice, { offset: 0, length: 45 });
});
for (const mutation of ["short header", "stale header", "ProgramData owner"] as const) test(`a ${mutation} refuses before fee proof`, async () => {
 const p = publicPort(false), original = p.rpc.call;
 p.rpc.call = async (method, params) => {
  const value = await original(method, params), slice = (params[1] as { dataSlice?: unknown } | undefined)?.dataSlice;
  if (method === "getMultipleAccounts" && slice !== undefined) {
   const row = value as { context: { slot: bigint }; value: ({ data: [string, string]; owner: string } | null)[] }, keys = params[0] as string[];
   if (mutation === "stale header") row.context.slot = 1n;
   for (const [i, key] of keys.entries()) if (programData().includes(key)) {
    if (mutation === "short header") row.value[i]!.data[0] = Buffer.from(row.value[i]!.data[0], "base64").subarray(0, 44).toString("base64");
    if (mutation === "ProgramData owner") row.value[i]!.owner = m.payer;
   }
  }
  return value;
 };
 await assert.rejects(new JupiterV1MaterialResolver(p.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports));
 assert.equal(p.reads.some(r => r.method === "getFeeForMessage"), false);
});
test("a changed executable payload is never read; a changed upgrade authority refuses before fee proof", async () => {
 const first = programData()[0]!;
 const payload = publicPort(true, (key, bytes) => { if (key === first) bytes[45] = bytes[45]! ^ 1; });
 const resolved = await new JupiterV1MaterialResolver(payload.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports);
 assert.equal(resolved.messageHash, m.messageHash);
 const authority = publicPort(true, (key, bytes) => { if (key === programData().find(k => Buffer.from(m.semanticAccounts.find(a => a.address === k)!.dataBase64, "base64")[12] === 1)) bytes[20] = bytes[20]! ^ 1; });
 await assert.rejects(new JupiterV1MaterialResolver(authority.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports),
  (error: { details?: { reason?: string } }) => error.details?.reason === "solana_program_authority_changed");
 assert.equal(authority.reads.some(r => r.method === "getFeeForMessage"), false);
});
test("an incomplete public batch refuses before any fee proof", async () => {
 const p = publicPort(true); p.rpc.batch = async () => [];
 await assert.rejects(new JupiterV1MaterialResolver(p.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports), /batch is incomplete/);
 assert.equal(p.reads.some(r => r.method === "getFeeForMessage"), false);
});
const small: readonly SolanaBatchRead[] = [{method: "getBlockHeight", params: []}, {method: "getMinimumBalanceForRentExemption", params: [165]}];
test("one physical POST carries two logical reads and is charged once to the command budget; nothing is stored", async t => {
 const temp = await temporaryState(); t.after(temp.cleanup); let posts = 0;
 const budget = new SolanaRpcBudget({maxPhysicalRequests: 1});
 const base = new SolanaRpc("https://rpc.example", async (_url, init) => {
  posts++; const requests = JSON.parse(String(init?.body)); assert.equal(requests.length, 2);
  return new Response(JSON.stringify(requests.map((q: any, i: number) => ({jsonrpc: "2.0", id: q.id, result: i + 1})).reverse()), {headers: {"content-type": "application/json"}});
 }, budget);
 const rpc = new JupiterV1BudgetedRpc(base);
 assert.deepEqual(await rpc.batch(small), [1n, 2n]);
 assert.equal(posts, 1); assert.equal(budget.physicalRequests, 1); assert.equal(budget.logicalCalls, 2);
 await assert.rejects(rpc.batch(small), {code: "APN_RPC_BUDGET_EXCEEDED"}); assert.equal(posts, 1);
 assert.deepEqual(await readdir(temp.root).catch(() => []), []);
});
test("Jupiter cannot batch a financial send into the public transport", async () => {
 let posts = 0;
 const rpc = new JupiterV1BudgetedRpc(new SolanaRpc("https://rpc.example", async () => {posts++; throw Error("forbidden");}));
 await assert.rejects(rpc.batch([{method: "sendTransaction", params: []}] as any)); assert.equal(posts, 0);
});

for(const malformed of ["none","missing","unknown"] as const)test(`single height batch charges once and refuses ${malformed} ID without scalar retry`,async()=>{
 let posts=0;
 const budget=new SolanaRpcBudget({maxPhysicalRequests:1});
 const rpc=new JupiterV1BudgetedRpc(new SolanaRpc("https://rpc.example",async(_url,init)=>{
  posts++;const body=JSON.parse(String(init?.body));assert.ok(Array.isArray(body));assert.equal(body.length,1);
  assert.equal(body[0].method,"getBlockHeight");assert.deepEqual(body[0].params,[{commitment:"confirmed"}]);
  return new Response(JSON.stringify(malformed==="missing"?[]:[{jsonrpc:"2.0",id:malformed==="unknown"?"foreign":body[0].id,result:433327703}]),{headers:{"content-type":"application/json"}});
 },budget));
 if(malformed==="none")assert.equal(await rpc.call("getBlockHeight",[{commitment:"confirmed"}]),433327703n);
 else await assert.rejects(rpc.call("getBlockHeight",[{commitment:"confirmed"}]),{code:"APN_RPC_PROTOCOL"});
 assert.equal(posts,1);assert.equal(budget.logicalCalls,1);assert.equal(budget.physicalRequests,1);
});

test("a call-only alternate height port keeps its scalar dispatch",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);let calls=0;
 const base=new SolanaRpc("https://rpc.example");Object.defineProperty(base,"batch",{value:undefined});
 t.mock.method(base,"call",async(method:SolanaMethod,params:readonly unknown[])=>{calls++;assert.equal(method,"getBlockHeight");assert.deepEqual(params,[{commitment:"confirmed"}]);return 1000n;});
 const rpc=new JupiterV1BudgetedRpc(base);assert.equal(await rpc.call("getBlockHeight",[{commitment:"confirmed"}]),1000n);assert.equal(calls,1);
});
