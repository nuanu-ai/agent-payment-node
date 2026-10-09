import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { NodeMetaMaskProcessRunner, takeMetaMaskNativeProcessFailureIdentifiers, type MetaMaskCapturedLaunchPort } from "../../src/metamask-process-runner.js";
const RID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", HASH=`0x${"a".repeat(64)}`, ADDRESS=`0x${"1".repeat(40)}`;
const notice=(id=RID)=>JSON.stringify({_notice:{kind:"AWAITING_MFA",pollingId:id}});
function runner(output:string,kind:"timeout"|"error"|"close"="timeout") {
 const input=Buffer.from(output);let killed=0;
 const launch:MetaMaskCapturedLaunchPort=()=>{const child=new EventEmitter() as EventEmitter&{stdout:EventEmitter;stderr:EventEmitter;kill():boolean};child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed++;return true;};queueMicrotask(()=>{child.stdout.emit("data",input);if(kind==="error")child.emit("error",new Error("synthetic"));if(kind==="close")child.emit("close",1);});return child;};
 return {process:new NodeMetaMaskProcessRunner(async()=>"/test-only",launch,undefined,20),input,killed:()=>killed};
}
async function rejection(r:ReturnType<typeof runner>){let caught:unknown;try{await r.process.runJson(["test"]);assert.fail("timeout must still reject");}catch(e){caught=e;}assert.ok(caught instanceof ApnError);assert.ok(r.input.every(b=>b===0));assert.ok(!JSON.stringify(caught).includes(RID));assert.ok(!JSON.stringify(caught).includes(HASH));return caught;}
test("timeout rejects while retaining one-use actual public RID outside enumerable error details",async()=>{const r=runner(notice());const e=await rejection(r);assert.deepEqual(takeMetaMaskNativeProcessFailureIdentifiers(e),{requestId:RID});assert.equal(takeMetaMaskNativeProcessFailureIdentifiers(e),undefined);assert.equal(r.killed(),1);});
test("actual captured error rejects while retaining bounded public hash and sender",async()=>{const r=runner(JSON.stringify({ok:true,data:{mode:"server",address:ADDRESS,hash:HASH,cliToken:"synthetic-secret"}}),"error");const e=await rejection(r);assert.deepEqual(takeMetaMaskNativeProcessFailureIdentifiers(e),{transactionHash:HASH,sender:ADDRESS});assert.ok(!JSON.stringify(e).includes("synthetic-secret"));});
for(const [name,bytes] of Object.entries({malformed:"not JSON",partial:"{",conflict:notice()+"\n"+notice("different"),badHash:JSON.stringify({ok:true,data:{mode:"server",address:ADDRESS,hash:"invalid",pollingId:RID}}),wrongMode:JSON.stringify({ok:true,data:{mode:"local",address:ADDRESS,hash:HASH}})}))test(`${name} rejected output supplies no failure identifiers`,async()=>{assert.equal(takeMetaMaskNativeProcessFailureIdentifiers(await rejection(runner(bytes))),undefined);});
test("oversize output refuses all partial hints and preserves rejection",async()=>{const r=runner(notice()+"x".repeat(1024*1024));assert.equal(takeMetaMaskNativeProcessFailureIdentifiers(await rejection(r)),undefined);});
test("ordinary nonzero exit still returns its original result rather than a failure observation",async()=>{const r=runner(notice(),"close");const v=await r.process.runJson(["test"]);assert.equal(v.exitCode,1);assert.equal(v.stdout.toString(),notice());assert.equal(takeMetaMaskNativeProcessFailureIdentifiers(v),undefined);v.stdout.fill(0);});
test("arbitrary error or DTO cannot create a native failure observation",()=>{assert.equal(takeMetaMaskNativeProcessFailureIdentifiers(new ApnError("APN_PROVIDER_UNAVAILABLE","fake")),undefined);assert.equal(takeMetaMaskNativeProcessFailureIdentifiers({requestId:RID,transactionHash:HASH}),undefined);});

test("complete normal notice before a cut final frame retains only its public RID",async()=>{const r=runner(notice()+"\n{\"_summary\":");assert.deepEqual(takeMetaMaskNativeProcessFailureIdentifiers(await rejection(r)),{requestId:RID});});
test("malformed complete frame before a cut tail cannot supply any hint",async()=>{const r=runner(notice()+"\n{\"_notice\":bad}\n{");assert.equal(takeMetaMaskNativeProcessFailureIdentifiers(await rejection(r)),undefined);});
test("conflicting complete notices before a cut final frame supply no hint",async()=>{const r=runner(notice()+"\n"+notice("different")+"\n{");assert.equal(takeMetaMaskNativeProcessFailureIdentifiers(await rejection(r)),undefined);});
