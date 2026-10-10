import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {NodeMetaMaskProcessRunner,takeMetaMaskNativeProcessFailureDiagnostic} from "../../src/metamask-process-runner.js";
import {validateMetaMaskNativeDiagnostic} from "../../src/metamask-native-diagnostic.js";

test("absolute deadline prevents a late package resolver from launching even a read child",async()=>{
 let launches=0;
 const runner=new NodeMetaMaskProcessRunner(async()=>{await new Promise(resolve=>setTimeout(resolve,100));return "/TEST-no-sdk";},()=>{launches++;throw new Error("must not launch");});
 const before=Date.now();let failure:unknown;try{await runner.runJson(["auth","status","--json"],30000,new Date(Date.now()+35).toISOString());}catch(error){failure=error;}
 assert.ok(failure);assert.equal(launches,0);assert.ok(Date.now()-before<1000);
 const diagnostic=takeMetaMaskNativeProcessFailureDiagnostic(failure);assert.equal(diagnostic?.stage,"sdk_resolver");assert.equal(diagnostic?.code,"deadline");assert.equal(diagnostic?.remainingMs,0);assert.equal(takeMetaMaskNativeProcessFailureDiagnostic(failure),undefined);
});
test("real TEST child timeout uses remaining deadline and returns only finite sanitized stderr classes",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"apn-mm-TEST-deadline-")),script=join(dir,"child.cjs");
 try{await writeFile(script,"process.stderr.write(JSON.stringify({error:{code:'MFA_REQUIRED',message:'TEST-secret'}}));setInterval(()=>{},1000);");
 const runner=new NodeMetaMaskProcessRunner(async()=>script);let failure:unknown;try{await runner.runJson(["wallet","send-transaction"],30000,new Date(Date.now()+250).toISOString());}catch(error){failure=error;}
 assert.ok(failure);const diagnostic=takeMetaMaskNativeProcessFailureDiagnostic(failure);assert.equal(diagnostic?.stage,"sdk_send");assert.equal(diagnostic?.code,"deadline");assert.equal(diagnostic?.providerCode,"mfa");assert.ok(!JSON.stringify(diagnostic).includes("TEST-secret"));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("diagnostic is immutable finite metadata and refuses message/raw output/unknown codes",()=>{
 const good={stage:"sdk_send",code:"exit",exitCode:1,signal:null,durationMs:10,remainingMs:100,stderrClass:"json_error",providerCode:"policy"};
 assert.ok(Object.isFrozen(validateMetaMaskNativeDiagnostic(good)));
 for(const bad of [{...good,message:"secret"},{...good,stderr:"secret"},{...good,code:"arbitrary"},{...good,remainingMs:60001}])assert.throws(()=>validateMetaMaskNativeDiagnostic(bad));
});
