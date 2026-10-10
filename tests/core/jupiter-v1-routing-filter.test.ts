import assert from "node:assert/strict";
import test from "node:test";
import { JupiterV1ReadOnlyProvider } from "../../src/swap/jupiter-solana/v1-provider.js";
import { fixture } from "../fixtures/jupiter-v1/material.js";
import { JupiterV1QuoteBuilder } from "../../src/swap/jupiter-solana/v1-builder.js";
import { JupiterV1MaterialResolver } from "../../src/swap/jupiter-solana/v1-resolver.js";
import type { SavedJupiterV1MaterialStore } from "../../src/swap/jupiter-solana/v1-material.js";
import { JUPITER_V1_WHIRLPOOL_V2_POOL } from "../../src/swap/jupiter-solana/v1-pins.js";
import type { JupiterV1RouteId } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { capturedFp } from "../fixtures/jupiter-v1-whirlpool-fp/capture.js";
const m=fixture(),request={inputMint:m.quoteResponse.inputMint,outputMint:m.quoteResponse.outputMint,amount:"1000000",taker:m.payer,recipient:m.payer,slippageBps:50,computeUnitPriceMicroLamports:1000};
test("finite legacy filter changes only the unsigned quote query and preserves the official response",async()=>{
 let seen:URL|undefined;
 const provider=new JupiterV1ReadOnlyProvider(async(input,init)=>{seen=new URL(String(input));assert.equal(init?.method,"GET");return new Response(JSON.stringify(m.quoteResponse),{headers:{"content-type":"application/json"}});});
 assert.deepEqual(await provider.quoteExactIn({...request,maximumInnerAccounts:12}),m.quoteResponse);
 assert.equal(seen?.searchParams.get("maxAccounts"),"12");assert.equal(seen?.searchParams.get("onlyDirectRoutes"),"true");assert.equal(seen?.searchParams.get("dexes"),"Whirlpool");
 assert.equal(seen?.searchParams.get("amount"),"1000000");assert.equal(seen?.searchParams.get("slippageBps"),"50");
});
test("ordinary read-only provider request retains unfiltered discovery",async()=>{
 let seen:URL|undefined;const provider=new JupiterV1ReadOnlyProvider(async input=>{seen=new URL(String(input));return new Response(JSON.stringify(m.quoteResponse),{headers:{"content-type":"application/json"}});});
 await provider.quoteExactIn(request);assert.equal(seen?.searchParams.has("maxAccounts"),false);
});
for(const maximumInnerAccounts of [0,11,13,"12",null])test(`invalid finite inner account limit ${String(maximumInnerAccounts)} refuses before HTTP`,async()=>{
 let calls=0;const provider=new JupiterV1ReadOnlyProvider(async()=>{calls++;throw Error("HTTP forbidden");});
 await assert.rejects(provider.quoteExactIn({...request,maximumInnerAccounts} as any));assert.equal(calls,0);
});

const unknownPool="11111111111111111111111111111111";
function withPool(pool:string){const quote=structuredClone(m.quoteResponse);return {...quote,routePlan:quote.routePlan.map(leg=>({...leg,swapInfo:{...leg.swapInfo,ammKey:pool}}))};}
const selected=new Error("TEST-only resolver reached after strict quote/build route admission");
async function discover(responses:readonly (unknown|Error)[],routeId:JupiterV1RouteId="whirlpool-v1-83-sol-usdc",build=m.rawBuildResponse){
 const urls:URL[]=[],posted:unknown[]=[];let resolved=0,proof=0,saved=0,get=0;
 const provider=new JupiterV1ReadOnlyProvider(async(input,init)=>{
  const url=new URL(String(input));urls.push(url);
  if(init?.method==="POST") {posted.push(JSON.parse(String(init.body)));return new Response(JSON.stringify(build),{headers:{"content-type":"application/json"}});}
  const response=responses[get++];if(response instanceof Error)throw response;
  return new Response(JSON.stringify(response),{headers:{"content-type":"application/json"}});
 });
 class Resolver extends JupiterV1MaterialResolver {override async resolve():Promise<never>{resolved++;throw selected;}}
 const resolver=new Resolver({originHash:"0".repeat(64),async call(){throw Error("RPC forbidden in discovery test");}});
 const store={async save(){saved++;}} as unknown as SavedJupiterV1MaterialStore;
 const builder=new JupiterV1QuoteBuilder(provider,resolver,store,{resolvePayer:async()=>m.payer,resolveRouteId:async()=>routeId,maximumNativeExpenseLamports:"6000000",computeUnitPriceMicroLamports:1000,proveQuote:async()=>{proof++;throw Error("Proof forbidden in discovery test");}});
 let error:unknown;try{await builder.quote({command:"swap.jupiter.quote",profile:"TEST-only",account:m.payer,recipient:m.payer,amountAtomic:"1000000",slippageBps:50,ownerSlippageCapBps:50,now:new Date("2026-09-20T00:00:00.000Z")});}catch(e){error=e;}
 for(const url of urls.filter(url=>url.pathname.endsWith("/quote"))){assert.equal(url.origin,"https://api.jup.ag");assert.equal(url.searchParams.get("amount"),"1000000");assert.equal(url.searchParams.get("slippageBps"),"50");assert.equal(url.searchParams.get("dexes"),"Whirlpool");assert.equal(url.searchParams.get("onlyDirectRoutes"),"true");assert.equal(url.searchParams.get("platformFeeBps"),"0");}
 assert.equal(proof,0);assert.equal(saved,0);return {urls,posted,resolved,error};
}
test("legacy discovery retries once without the hint and builds only the policy-selected pool",async()=>{
 const r=await discover([withPool(unknownPool),m.quoteResponse]);assert.equal(r.error,selected);assert.equal(r.resolved,1);assert.equal(r.urls.length,3);
 assert.equal(r.urls[0]?.searchParams.get("maxAccounts"),"12");assert.equal(r.urls[1]?.searchParams.has("maxAccounts"),false);
 assert.deepEqual((r.posted[0] as any).quoteResponse,m.quoteResponse);
});
test("an admitted filtered quote has no second discovery request",async()=>{
 const r=await discover([m.quoteResponse]);assert.equal(r.error,selected);assert.equal(r.resolved,1);assert.equal(r.urls.length,2);
});
for(const pool of [unknownPool,JUPITER_V1_WHIRLPOOL_V2_POOL])test(`unfiltered discovery cannot admit another pool ${pool}`,async()=>{
 const r=await discover([withPool(unknownPool),withPool(pool)]);assert.equal((r.error as any)?.code,"APN_OPERATION_BLOCKED");assert.equal(r.urls.length,2);assert.equal(r.resolved,0);assert.equal(r.posted.length,0);
});
test("a failed official first read is terminal without a discovery retry",async()=>{
 const r=await discover([new Error("HTTP failure")]);assert.equal((r.error as any)?.code,"APN_PROVIDER_PROTOCOL");assert.equal(r.urls.length,1);assert.equal(r.resolved,0);
});
test("a malformed official first response is terminal without a discovery retry",async()=>{
 const r=await discover([{}]);assert.equal((r.error as any)?.code,"APN_PROVIDER_PROTOCOL");assert.equal(r.urls.length,1);assert.equal(r.resolved,0);
});
test("a failed second discovery read is terminal without a third request",async()=>{
 const r=await discover([withPool(unknownPool),new Error("HTTP failure")]);assert.equal((r.error as any)?.code,"APN_PROVIDER_PROTOCOL");assert.equal(r.urls.length,2);assert.equal(r.resolved,0);
});
test("V2 policy selection has no legacy hint or legacy discovery fallback",async()=>{
 const r=await discover([m.quoteResponse],"whirlpool-swap-v2-esv-sol-usdc");assert.equal((r.error as any)?.code,"APN_OPERATION_BLOCKED");assert.equal(r.urls.length,1);assert.equal(r.urls[0]?.searchParams.has("maxAccounts"),false);assert.equal(r.resolved,0);
});
test("Fp's separately admitted legacy ABI receives the same bounded account hint",async()=>{
 const c=capturedFp(),r=await discover([c.quote],"whirlpool-v1-fp-sol-usdc",c.build);
 assert.equal(r.error,selected);assert.equal(r.urls.length,2);assert.equal(r.urls[0]?.searchParams.get("maxAccounts"),"12");assert.equal(r.resolved,1);
});
test("Fp discovery can retry once but never build a foreign policy-selected pool",async()=>{
 const c=capturedFp(),r=await discover([m.quoteResponse,c.quote],"whirlpool-v1-fp-sol-usdc",c.build);
 assert.equal(r.error,selected);assert.equal(r.urls.length,3);assert.equal(r.urls[0]?.searchParams.get("maxAccounts"),"12");assert.equal(r.urls[1]?.searchParams.has("maxAccounts"),false);
 assert.deepEqual((r.posted[0] as any).quoteResponse,c.quote);
 const refused=await discover([m.quoteResponse,m.quoteResponse],"whirlpool-v1-fp-sol-usdc",c.build);
 assert.equal((refused.error as any)?.code,"APN_OPERATION_BLOCKED");assert.equal(refused.resolved,0);assert.equal(refused.posted.length,0);assert.equal(refused.urls.length,2);
});
