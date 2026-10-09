import test from "node:test";
import assert from "node:assert/strict";
import { mkdir,readFile,readdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson,hashObject } from "../../src/canonical.js";
import { Cleanup85NativeCancellation } from "../../src/circle-cleanup85-native-cancellation.js";
import { cleanup85OperationEnvelope } from "../../src/circle-cleanup85-native-binding.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { CLEANUP85_OWNER,CLEANUP85_RECIPIENT } from "../../src/circle-cleanup85-native-codec.js";
import { cleanup85PublicState,cleanup85PublicTransport,fixtureNow } from "./cleanup85-native-public-fixture.js";
import { temporaryState } from "./helpers.js";
import type { ProviderProfileRecord } from "../../src/provider-profile.js";
const environment={APN_ARBITRUM_RPC_URL:"https://arbitrum-one-public.nodies.app",APN_SEI_RPC_URL:"https://evm-rpc.sei-apis.com"};
async function usageBytes(root:string){const base=join(root,"asset-usage"),rows:Record<string,string>={};for(const bucket of await readdir(base))for(const name of await readdir(join(base,bucket)))rows[`${bucket}/${name}`]=await readFile(join(base,bucket,name),"utf8");return rows;}
async function roster(){return JSON.parse(await readFile(new URL("../fixtures/cleanup85-native/delegated-roster.json",import.meta.url),"utf8")) as {matches:{profileHash:string;rawPublicProviderMetadata:ProviderProfileRecord}[]};}
async function restore(root:string){const captured=await roster();assert.equal(captured.matches.length,4);for(const entry of captured.matches){const path=join(root,"profiles",entry.profileHash);await mkdir(path,{recursive:true,mode:0o700});await writeFile(join(path,"profile.json"),canonicalJson(entry.rawPublicProviderMetadata)+"\n",{mode:0o600});}return captured;}
test("captured four delegated Buyer aliases reach normal native prepare/reserve/foreground without changing finite wire",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const f=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport();await restore(temp.root);let keys=0,prompts=0;
 const parent=await readFile(join(temp.root,"circle-v2-evm",`${f.parent.operationId}.json`));
 const service=new Cleanup85NativeCancellation(f.state,{load:async()=>{keys++;throw Error("private_FORBIDDEN");},create:async()=>{throw Error("private_FORBIDDEN");}},environment,{https:rpc.https,now:()=>fixtureNow,approve:async op=>{
  prompts++;const e=cleanup85OperationEnvelope(op);assert.equal(e.nonceAtomic,"85");assert.equal(e.data,"0x");assert.equal(e.chainId,42161);assert.equal(e.valueAtomic,"1");assert.equal(e.to,CLEANUP85_RECIPIENT);assert.ok(BigInt(e.maxFeePerGasAtomic)>=45000000n);assert.equal(op.evm!.valueAtomic,"1");assert.equal(op.evm!.transactionTo,CLEANUP85_RECIPIENT);assert.equal(op.evm!.maxFeeWei,"2000000000000");assert.equal(op.evm!.cleanup85Cancellation!.request.recoveryBinding,f.request.recoveryBinding);throw Error("stop_foreground_NO_SIGNATURE");
 }});
 await assert.rejects(service.execute(f.request),/stop_foreground_NO_SIGNATURE/);const op=(await f.state.listOperations(f.parent.profileHash))[0]!;
 assert.equal(op.state,"awaiting_approval");assert.equal(op.operationId,f.state.operationId("evm-live-buyer",`cleanup85-native:${f.request.recoveryBinding}`));
 const row=await new AssetUsageLedger(temp.root).load({account:CLEANUP85_OWNER,chain:"eip155:42161",asset:{kind:"native",identifier:null}},op.evm!.cleanup85Cancellation!.nativeReservationId);
 assert.equal(row?.state,"reserved");assert.equal(row?.amountAtomic,"2000000000000");assert.equal(keys,0);assert.equal(prompts,1);assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));assert.deepEqual(await readFile(join(temp.root,"circle-v2-evm",`${f.parent.operationId}.json`)),parent);
 await assert.rejects(readFile(join(temp.root,"direct-public-effects",op.profileHash,`${op.operationId}.signing.json`)),{code:"ENOENT"});
});
// Synthetic hostile topology variants of genuine public records; no fabricated crypto-positive owner.
for(const kind of ["sender_raw_wallet","recipient_raw_wallet","sender_raw_provider","recipient_raw_provider","wrong_trust_class","wrong_provider_kind","unknown_trust_class"] as const)test(`normal native ${kind} refuses before reservation/foreground/private entry`,async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const f=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport(),captured=await restore(temp.root);let keys=0,prompts=0;
 const target=kind.startsWith("recipient")?CLEANUP85_RECIPIENT:CLEANUP85_OWNER;
 if(kind.endsWith("raw_wallet")){
  const profile=`hostile-${kind}`,createdAt=new Date(fixtureNow).toISOString(),body={schemaVersion:"apn.state.v1" as const,profile,profileHash:f.state.profileHash(profile),address:target as `0x${string}`,createdAt,bindingHash:hashObject({profile,address:target,createdAt})};await f.state.writeNewWallet({...body,integrityHash:hashObject(body)});
 }else if(kind.endsWith("raw_provider")){
  const own=JSON.parse(await readFile(join(temp.root,"profiles",f.parent.profileHash,"profile.json"),"utf8")),profile=`hostile-${kind}`,hash=f.state.profileHash(profile);own.profile=profile;own.profile_hash=hash;own.public_address=target;await mkdir(join(temp.root,"profiles",hash),{mode:0o700});await writeFile(join(temp.root,"profiles",hash,"profile.json"),canonicalJson(own)+"\n",{mode:0o600});
 }else{
  const entry=captured.matches[0]!,body:Record<string,unknown>={...entry.rawPublicProviderMetadata};if(kind==="wrong_provider_kind")body.provider_id="local";else body.trust_class=kind==="wrong_trust_class"?"local_software_wallet":"unknown";await writeFile(join(temp.root,"profiles",entry.profileHash,"profile.json"),canonicalJson(body)+"\n");
 }
 const usageBefore=await usageBytes(temp.root),before=await readFile(join(temp.root,"circle-v2-evm",`${f.parent.operationId}.json`));const service=new Cleanup85NativeCancellation(f.state,{load:async()=>{keys++;throw Error("private_FORBIDDEN");},create:async()=>{throw Error("private_FORBIDDEN");}},environment,{https:rpc.https,now:()=>fixtureNow,approve:async()=>{prompts++;}});
 await assert.rejects(service.execute(f.request),/bound to another APN profile|Provider|provider|trust/);assert.equal(keys,0);assert.equal(prompts,0);assert.equal((await f.state.listOperations(f.parent.profileHash)).length,0);assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));assert.deepEqual(await readFile(join(temp.root,"circle-v2-evm",`${f.parent.operationId}.json`)),before);
 assert.deepEqual(await usageBytes(temp.root),usageBefore);await assert.rejects(readFile(join(temp.root,"circle-cleanup85-native",`${f.parent.operationId}-slot.json`)),{code:"ENOENT"});
});
