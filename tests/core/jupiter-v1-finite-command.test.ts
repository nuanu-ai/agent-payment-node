import test from "node:test";
import assert from "node:assert/strict";
import { temporaryState } from "./helpers.js";
import { StateStore } from "../../src/state.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { allowlistDecisionFingerprint } from "../../src/allowlist-policy-activation.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { SolanaRpc, SolanaRpcBudget } from "../../src/solana/rpc.js";
import { SolanaRpcPacer } from "../../src/solana/pacing.js";
import { createJupiterV1Runtime } from "../../src/swap/jupiter-solana/v1-runtime-factory.js";
import { executeJupiterCommand } from "../../src/swap/jupiter-solana/command-service.js";
import { JUPITER_V1_FINITE_ROUTES, JUPITER_V1_OLD_ROUTE, JUPITER_V1_WHIRLPOOL_FP_ROUTE as OLD, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE as NEW, JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE as NEW83 } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { syntheticFpMaterial } from "../fixtures/jupiter-v1-whirlpool-fp/material.js";
import { syntheticRuntime099da3Material } from "../fixtures/jupiter-v1-runtime-099da3/material.js";
import { simulation } from "../fixtures/jupiter-v1/scenarios.js";
import type { RuntimeContext } from "../../src/runtime.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { validateSwapOperation } from "../../src/swap/model.js";

test("finite inventory includes every additive source-reviewed route without owner admission",async t => {
 const temp=await temporaryState();t.after(temp.cleanup);
 const result=await executeJupiterCommand({command:"swap.jupiter.inventory"},{state:new StateStore(temp.root),clock:{now:()=>new Date()}} as RuntimeContext);
 const data=result.data as {v1:{additionalFiniteMechanisms:{mechanismDigest:string;admitted:boolean}[]}};
 assert.deepEqual(data.v1.additionalFiniteMechanisms.map(r=>r.mechanismDigest),JUPITER_V1_FINITE_ROUTES.filter(r=>r.routeId!==JUPITER_V1_OLD_ROUTE.routeId).map(r=>swapMechanismDigest(r.mechanismPin)));
 assert.ok(data.v1.additionalFiniteMechanisms.every(r=>r.admitted===false));
});
for (const [label,ROUTE,material] of [["historical",OLD,syntheticFpMaterial],["runtime 099da3",NEW,syntheticRuntime099da3Material],["runtime 099da3 83",NEW83,()=>syntheticRuntime099da3Material("83")]] as const)
test(`SYNTHETIC ${label} Fp production factory quote, prepare and CLI status pass the same finite mechanism gate without custody or send`,async t => {
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root),profile="test-fp-command",m=material();
 const wrapping={async load(){return Buffer.alloc(32,77);},async create(){return Buffer.alloc(32,77);}},accounts=new ChainAccountStore(temp.root,wrapping);
 await accounts.ensureLocal({profile,rail:"solana",create:async()=>({address:m.payer,seed:Buffer.alloc(32,9)})});
 const now=new Date(),policy=new AllowlistPolicyStore(temp.root),staged=await policy.stage({profile,now,policy:{schemaVersion:"apn.allowlist-policy-file.v1",overlayVersion:"test-fp.1",accounts:{solana:m.payer},effectiveAt:new Date(now.getTime()-1000).toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),admissions:[{chain:ROUTE.mechanismPin.chain,kind:"native",rail:"swap",maximumPerTransferAtomic:"6000000",dailyLimitAtomic:"6000000",mechanism:ROUTE.mechanismPin},{chain:ROUTE.mechanismPin.chain,kind:"token",identifier:m.quoteResponse.outputMint,rail:"swap",maximumPerTransferAtomic:"500000",dailyLimitAtomic:"500000",mechanism:ROUTE.mechanismPin}]}});
 await policy.appendDecision(profile,null,{status:"active",revision:staged.revision,stagedRecordDigest:staged.recordDigest,policyDigest:staged.registry.policyDigest,registry:staged.registry,approvalFingerprint:allowlistDecisionFingerprint({action:"activate",profileHash:allowlistProfileHash(profile),revision:staged.revision,stagedRecordDigest:staged.recordDigest,policyDigest:staged.registry.policyDigest,headEntryDigest:null}),decidedAt:now.toISOString()});
 const g=await guardJupiterV1WhirlpoolMaterial(m),sim=simulation(g);sim.context.slot=Number(m.accountSlot)+1;let secrets=0,sends=0,clockMs=Date.now();
 const rpc=new SolanaRpc("https://example.com",async(_url,init)=>{const q=JSON.parse(String(init?.body));const handle=(r:any)=>{let result:unknown;const wire=(key:string,slice?:{offset:number;length:number})=>{const a=m.semanticAccounts.find(a=>a.address===key);if(a===undefined||a.existence==="absent")return null;const d=Buffer.from(a.dataBase64,"base64");return {owner:a.owner,lamports:Number(a.lamports),executable:a.executable,data:[(slice===undefined?d:d.subarray(slice.offset,slice.offset+slice.length)).toString("base64"),"base64"],space:d.length,rentEpoch:0};};
 switch(r.method){case "getGenesisHash":result=m.genesis;break;case "getMultipleAccounts":result={context:{slot:Number(m.accountSlot)},value:r.params[0].map((k:string)=>wire(k,r.params[1]?.dataSlice))};break;case "getAccountInfo":result={context:{slot:Number(m.accountSlot)},value:wire(r.params[0],r.params[1]?.dataSlice)};break;case "getLatestBlockhash":result={context:{slot:Number(m.accountSlot)},value:{blockhash:m.lifetime.blockhash,lastValidBlockHeight:Number(m.lifetime.lastValidBlockHeight)}};break;case "getFeeForMessage":result={context:{slot:Number(m.accountSlot)},value:6400};break;case "getBlockHeight":result=Number(m.lifetime.lastValidBlockHeight)-100;break;case "getMinimumBalanceForRentExemption":result=1488440;break;case "simulateTransaction":result=sim;break;case "sendTransaction":sends++;throw Error("TEST forbids send");default:throw Error(`Unexpected TEST RPC ${r.method}`);}
 return {jsonrpc:"2.0",id:r.id,result};};return new Response(JSON.stringify(Array.isArray(q)?q.map(handle):handle(q)),{headers:{"content-type":"application/json"}});},new SolanaRpcBudget({maxPhysicalRequests:64,minimumIntervalMs:750,now:()=>clockMs,wait:async ms=>{clockMs+=ms;}}),new SolanaRpcPacer(state,()=>clockMs,async ms=>{clockMs+=ms;}));
 const runtime=createJupiterV1Runtime({state,clock:{now:()=>new Date()},rpc,wrappingSecret:{async load(){secrets++;throw Error("TEST custody forbidden");},async create(){throw Error();}},foreground:false,stage:"quote",providerFetch:async url=>new Response(JSON.stringify(String(url).includes("/quote?")?m.quoteResponse:m.rawBuildResponse),{headers:{"content-type":"application/json"}})});
 const quote=await runtime.quote({command:"swap.jupiter.quote",profile,account:m.payer,recipient:m.payer,amountAtomic:"1000000",slippageBps:50,ownerSlippageCapBps:50},new Date()) as {quoteHash:string};
 const op=await runtime.prepare({profile,quoteHash:quote.quoteHash,idempotencyKey:"test-fp-command"},new Date());
 const result=await executeJupiterCommand({command:"swap.jupiter.status",operationId:op.operationId},{state,clock:{now:()=>new Date()},jupiterV1Runtime:runtime} as RuntimeContext);
 const checked=validateSwapOperation(result.operation);
 assert.equal(checked.operationId,op.operationId);assert.equal(checked.mechanismDigest,swapMechanismDigest(ROUTE.mechanismPin));assert.equal(checked.submissionMarker,null);assert.equal(checked.state,"awaiting_approval");assert.deepEqual(result.nextActions,[`apn swap solana jupiter approve --operation ${op.operationId}`]);assert.equal(checked.usageLease,null);assert.equal(secrets,0);assert.equal(sends,0);
});
