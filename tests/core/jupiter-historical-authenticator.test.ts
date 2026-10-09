import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, readdir, rm, rename, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, domainHash, sha256 } from "../../src/canonical.js";
import { JupiterHistoricalAuthenticator as FixedHistoricalAuthenticator, HISTORICAL_JUPITER_IDS } from "../../src/swap/jupiter-solana/historical-authenticator.js";
import { JupiterHistoricalProjectionReader } from "../../src/swap/jupiter-solana/historical-projection-reader.js";
import { HistoricalBindingReader } from "../../src/swap/jupiter-solana/historical-authentication-readers.js";
import { historicalFixture } from "./jupiter-historical-authentication-fixture.js";
import { temporaryState } from "./helpers.js";
async function snapshot(root: string, prefix=""): Promise<Record<string,string>> {
 const result:Record<string,string>={};for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){if(prefix===""&&entry.name==="locks")continue;const path=join(prefix,entry.name);if(entry.isDirectory())Object.assign(result,await snapshot(root,path));else result[path]=sha256(await readFile(join(root,path)));}return result;
}
const child=process.env.APN_JUPITER_AUTH_TEST_PTY_CHILD==="1";
async function inPty(title:string, action:()=>Promise<void>):Promise<void>{
 if(child){process.stdout.write(`PTY_CASE_ENTERED:${title}\n`);return await action();}
 const python=String.raw`import os,pty,select,subprocess,sys,re,time
master,slave=pty.openpty()
def session():
 os.setsid()
 import fcntl,termios
 fcntl.ioctl(slave,termios.TIOCSCTTY,0)
env=dict(os.environ);env.pop('NODE_TEST_CONTEXT',None);env['APN_JUPITER_AUTH_TEST_PTY_CHILD']='1'
proc=subprocess.Popen([sys.argv[1],'--test','--test-isolation=none','--test-concurrency=1','--test-name-pattern','^'+sys.argv[3]+'$',sys.argv[2]],stdin=slave,stdout=slave,stderr=slave,env=env,preexec_fn=session)
os.close(slave);output=b'';pending=b'';deadline=time.time()+90
while time.time()<deadline:
 ready,_,_=select.select([master],[],[],.1)
 if ready:
  try:part=os.read(master,65536)
  except OSError:break
  output+=part;pending+=part
  match=re.search(rb'Type ([^\r\n]+) and press Enter to confirm\.',pending)
  if match:os.write(master,match.group(1)+b'\n');pending=pending[match.end():]
 if proc.poll() is not None:break
else:proc.kill()
os.close(master);proc.wait();sys.stdout.buffer.write(output);sys.exit(proc.returncode)
`;
 await new Promise<void>((resolve,reject)=>{const p=spawn("python3",["-c",python,process.execPath,fileURLToPath(import.meta.url),title],{stdio:["ignore","pipe","pipe"]});let output="";p.stdout.on("data",b=>output+=String(b));p.stderr.on("data",b=>output+=String(b));p.on("error",reject);p.on("exit",code=>code===0&&output.includes(`PTY_CASE_ENTERED:${title}`)?resolve():reject(new Error(output)));});
}
test("plain projection reader refuses unknown ID and absent root without creating state",async t=>{const f=await temporaryState();t.after(f.cleanup);let keys=0;const a=new JupiterHistoricalProjectionReader(f.root,{load:async()=>{keys++;return null;},create:async()=>{throw Error();}});await assert.rejects(a.read("f".repeat(64)));await assert.rejects(a.read(HISTORICAL_JUPITER_IDS[0]));assert.equal(keys,0);assert.deepEqual(await readdir(f.base),[]);});
const positive="plain projection reader authenticates generated TEST wallet via genuine TTY";
test(positive,async()=>inPty(positive,async()=>{const f=await historicalFixture();try{const before=await snapshot(f.temp.root);let loads=0;const a=new JupiterHistoricalProjectionReader(f.temp.root,{load:async()=>{loads++;return Buffer.alloc(32,77);},create:async()=>{throw Error("create forbidden");}});const result=await a.read(f.op.operationId);assert.equal(loads,1);assert.equal(result.projection.maximumNativeExpenseLamports,"6000000");assert.equal(result.projection.principalLamports,"1000000");assert.equal(result.projection.signature,f.effect.transactionId);assert.equal(result.projection.blockhash,f.material.lifetime.blockhash);assert.equal(result.projection.ordinaryRecentBlockhash,true);assert.equal(JSON.stringify(result).includes(f.effect.rawPayload),false);assert.equal(JSON.stringify(result).includes("seedHex"),false);assert.deepEqual(await snapshot(f.temp.root),before);assert.equal("authority" in result,false);await assert.rejects(new FixedHistoricalAuthenticator(f.temp.root,f.wrapping).consume(result.projection as never,f.op.operationId));}finally{await f.temp.cleanup();}}));
for(const kind of ["wrong wrapping key","changed material after consent","changed lifetime after consent","changed custody after consent"]){const title=`plain projection reader rejects ${kind} after normal consent`;test(title,async()=>inPty(title,async()=>{const f=await historicalFixture();try{let loads=0;const a=new JupiterHistoricalProjectionReader(f.temp.root,{load:async()=>{loads++;if(kind==="changed custody after consent"){const path=join(f.temp.root,"chain-accounts","solana",`${f.account.profileHash}.json`),value=JSON.parse(await readFile(path,"utf8"));value.createdAt=new Date(0).toISOString();const {identityHash:_,...body}=value;await writeFile(path,canonicalJson({...body,identityHash:sha256(canonicalJson(body))}),{mode:0o600});}if(kind.startsWith("changed material")||kind.startsWith("changed lifetime")){const path=join(f.temp.root,"jupiter-v1-quotes",`${f.op.quote.quoteHash}.json`),value=JSON.parse(await readFile(path,"utf8"));value.serializedHash="0".repeat(64);await writeFile(path,canonicalJson(value),{mode:0o600});}return Buffer.alloc(32,kind==="wrong wrapping key"?78:77);},create:async()=>{throw Error();}});await assert.rejects(a.read(f.op.operationId));assert.equal(loads,1);}finally{await f.temp.cleanup();}}));}
for(const kind of ["missing material chunk","changed prepared cap","changed public signature","missing claim","changed original fingerprint","changed genesis","changed source profile","changed fresh lifetime"]){test(`public ${kind} refuses before private wrapping`,async t=>{const f=await historicalFixture();t.after(f.temp.cleanup);let loads=0;const a=new JupiterHistoricalProjectionReader(f.temp.root,{load:async()=>{loads++;return Buffer.alloc(32,77);},create:async()=>{throw Error();}});const dir=f.op.ownerProfileHash;
 let path:string;
 if(kind==="missing material chunk"){const m=JSON.parse(await readFile(join(f.temp.root,"jupiter-v1-quotes",`${f.op.quote.quoteHash}.json`),"utf8"));await rm(join(f.temp.root,"jupiter-v1-quotes","chunks",`${m.chunks[0].hash}.json`));}
 else if(kind==="missing claim")await rm(join(f.temp.root,"jupiter-v1-claims",dir,`${f.op.operationId}.json`));
 else {path=kind==="changed prepared cap"?join(f.temp.root,"jupiter-v1-prepared",dir,`${f.op.operationId}.json`):kind==="changed public signature"?join(f.temp.root,"jupiter-v1-signatures",dir,`${f.op.operationId}.json`):kind==="changed original fingerprint"?join(f.temp.root,"jupiter-v1-bindings",dir,`${f.op.operationId}.json`):kind==="changed fresh lifetime"?join(f.temp.root,"jupiter-v1-fresh",dir,`${f.op.operationId}.json`):f.opPath;
 const v=JSON.parse(await readFile(path,"utf8"));if(kind==="changed prepared cap"){v.maximumNativeExpenseLamports="5000000";const {preparedHash:_,...b}=v;v.preparedHash=domainHash(v.schemaVersion,canonicalJson(b));}else if(kind==="changed public signature")v.signature="1".repeat(88);else if(kind==="changed original fingerprint")v.bindingHash="0".repeat(64);else if(kind==="changed fresh lifetime")v.serializedHash="0".repeat(64);else if(kind==="changed genesis"){v.quote.sourceAsset.chain="solana:11111111111111111111111111111111";}else v.quote.profile="foreign-owner";await writeFile(path,canonicalJson(v),{mode:0o600});}
 await assert.rejects(a.read(f.op.operationId));assert.equal(loads,0);});}

const lower="plain projection reader projects genuine original cap without substituting current6M";
test(lower,async()=>inPty(lower,async()=>{const f=await historicalFixture({cap:"5000000"});try{const a=new JupiterHistoricalProjectionReader(f.temp.root,f.wrapping);assert.equal((await a.read(f.op.operationId)).projection.maximumNativeExpenseLamports,"5000000");}finally{await f.temp.cleanup();}}));
for (const kind of ["bad signature", "wrong encrypted fingerprint", "wrong encrypted signature identity"]) { const title=`plain projection reader rejects authenticated container ${kind}`;test(title,async()=>inPty(title,async()=>{const f=await historicalFixture({mutateSealedEffect:e=>{if(kind==="wrong encrypted fingerprint")return {...e,fingerprint:"f".repeat(64)};if(kind==="wrong encrypted signature identity")return {...e,transactionId:"1".repeat(88)};const bytes=Buffer.from(e.rawPayload,"base64");bytes[1]=bytes[1]!^1;const rawPayload=bytes.toString("base64");return {...e,rawPayload,rawPayloadHash:sha256(rawPayload)};}});try{const a=new JupiterHistoricalProjectionReader(f.temp.root,f.wrapping);await assert.rejects(a.read(f.op.operationId));}finally{await f.temp.cleanup();}}));}

const tagTitle="plain projection reader rejects altered generated AEAD tag";
test(tagTitle,async()=>inPty(tagTitle,async()=>{const f=await historicalFixture();try{const path=join(f.temp.root,"chain-wallets","solana",`${f.account.profileHash}.json`),v=JSON.parse(await readFile(path,"utf8"));const tag=Buffer.from(v.tag,"base64");tag[0]=tag[0]!^1;v.tag=tag.toString("base64");await writeFile(path,canonicalJson(v),{mode:0o600});await assert.rejects(new JupiterHistoricalProjectionReader(f.temp.root,f.wrapping).read(f.op.operationId));}finally{await f.temp.cleanup();}}));
const retiredTitle="plain projection reader never authenticates a terminal or different stored operation";
test(retiredTitle,async t=>{const f=await historicalFixture();t.after(f.temp.cleanup);const changed=f.resealOperation({...f.op,state:"failed_before_effect"});await writeFile(f.opPath,canonicalJson(changed),{mode:0o600});let keys=0;await assert.rejects(new JupiterHistoricalProjectionReader(f.temp.root,{load:async()=>{keys++;return Buffer.alloc(32,77);},create:async()=>{throw Error();}}).read(f.op.operationId));assert.equal(keys,0);});

const rehashTitle="plain projection reader rejects recomputed public binding hashes against original encrypted fingerprint";
test(rehashTitle,async()=>inPty(rehashTitle,async()=>{const f=await historicalFixture();try{const dir=f.op.ownerProfileHash;for(const [kind,field,domain] of [["bindings","bindingHash","apn.jupiter-v1-execution-binding.v1"],["claims","claimHash","apn.jupiter-v1-send-claim.v1"],["signatures","recordHash","apn.jupiter-v1-signed-marker.v1"]] as const){const path=join(f.temp.root,`jupiter-v1-${kind}`,dir,`${f.op.operationId}.json`),v=JSON.parse(await readFile(path,"utf8"));if(kind==="bindings"){v.checkedAt=new Date(Date.parse(v.checkedAt)+1).toISOString();const {[field]:_,...body}=v;v[field]=domainHash(domain,canonicalJson(body));await writeFile(path,canonicalJson(v),{mode:0o600});}else{const b=JSON.parse(await readFile(join(f.temp.root,"jupiter-v1-bindings",dir,`${f.op.operationId}.json`),"utf8"));v.bindingHash=b.bindingHash;const {[field]:_,...body}=v;v[field]=domainHash(domain,canonicalJson(body));await writeFile(path,canonicalJson(v),{mode:0o600});}}let keys=0;await assert.rejects(new JupiterHistoricalProjectionReader(f.temp.root,{load:async()=>{keys++;return Buffer.alloc(32,77);},create:async()=>{throw Error();}}).read(f.op.operationId));assert.equal(keys,1);}finally{await f.temp.cleanup();}}));

for (const id of HISTORICAL_JUPITER_IDS) test(`fixed historical issuer refuses generated wrong owner ${id}`,async t=>{const f=await historicalFixture({operationId:id});t.after(f.temp.cleanup);let keys=0;const before=await snapshot(f.temp.root);const issuer=new FixedHistoricalAuthenticator(f.temp.root,{load:async()=>{keys++;return Buffer.alloc(32,77);},create:async()=>{throw Error();}});await assert.rejects(issuer.authenticate(id));assert.equal(keys,0);assert.deepEqual(await snapshot(f.temp.root),before);const dto={projection:{operationId:id},authority:{}};await assert.rejects(issuer.consume(dto.authority as never,id));await assert.rejects(issuer.consume({...dto.authority} as never,id));});

const ea25 = HISTORICAL_JUPITER_IDS[1];
const signedOnlyPositive = "exact ea25 authenticates generated TEST signed material with no retained send claim";
test(signedOnlyPositive, async () => inPty(signedOnlyPositive, async () => {
 const f=await historicalFixture({operationId:ea25,omitClaim:true});
 try {
  const before=await snapshot(f.temp.root), a=new JupiterHistoricalProjectionReader(f.temp.root,f.wrapping), {projection}=await a.read(ea25);
  assert.equal(projection.signature,f.effect.transactionId); assert.equal(projection.rawPayloadHash,f.effect.rawPayloadHash);
  assert.equal(projection.originalBindingHash,f.binding.bindingHash);assert.equal(projection.maximumNativeExpenseLamports,"6000000");
  assert.equal(projection.retainedClaimEvidence.kind,"retained_send_claim_absent");
  if(projection.retainedClaimEvidence.kind!=="retained_send_claim_absent")assert.fail();
  assert.equal(projection.retainedClaimEvidence.observation,"current_observation");assert.equal(projection.retainedClaimEvidence.submissionHistory,"unknown");
  assert.equal(projection.retainedClaimEvidence.transactionMayHaveBeenSubmitted,true);
  assert.match(projection.retainedClaimEvidence.absenceSnapshotHash,/^[a-f0-9]{64}$/u);
  assert.deepEqual(await snapshot(f.temp.root),before);assert.equal("wasSubmitted" in projection,false);
  assert.equal(JSON.stringify(projection).includes(f.effect.rawPayload),false);
  await assert.rejects(new FixedHistoricalAuthenticator(f.temp.root,f.wrapping).consume(projection as never,ea25));
 } finally {await f.temp.cleanup();}
}));
for(const id of [HISTORICAL_JUPITER_IDS[0],HISTORICAL_JUPITER_IDS[2]])test(`missing retained claim for other finite target ${id} refuses before private wrapping`,async t=>{
 const f=await historicalFixture({operationId:id,omitClaim:true});t.after(f.temp.cleanup);let keys=0;
 await assert.rejects(new JupiterHistoricalProjectionReader(f.temp.root,{load:async()=>{keys++;return Buffer.alloc(32,77);},create:async()=>{throw Error();}}).read(id));assert.equal(keys,0);
});
for(const kind of ["corrupt occupied claim","valid wrong binding claim","valid wrong raw hash claim","valid wrong signature claim","invalid signed marker","missing signed marker","symlink claim","missing claim directory"]){
 test(`exact ea25 signed-only ${kind} refuses before private wrapping`,async t=>{
  const f=await historicalFixture({operationId:ea25,omitClaim:kind!=="corrupt occupied claim"&&!kind.startsWith("valid wrong")});t.after(f.temp.cleanup);
  const claimPath=join(f.temp.root,"jupiter-v1-claims",f.op.ownerProfileHash,`${ea25}.json`),markerPath=join(f.temp.root,"jupiter-v1-signatures",f.op.ownerProfileHash,`${ea25}.json`);
  if(kind==="corrupt occupied claim")await writeFile(claimPath,"{}",{mode:0o600});
  else if(kind.startsWith("valid wrong")){const v=JSON.parse(await readFile(claimPath,"utf8"));if(kind==="valid wrong binding claim")v.bindingHash="f".repeat(64);else if(kind==="valid wrong raw hash claim")v.rawPayloadHash="f".repeat(64);else v.signature="1".repeat(88);const {claimHash:_,...body}=v;v.claimHash=domainHash(v.schemaVersion,canonicalJson(body));await writeFile(claimPath,canonicalJson(v),{mode:0o600});}
  else if(kind==="invalid signed marker"){const v=JSON.parse(await readFile(markerPath,"utf8"));v.rawPayloadHash="f".repeat(64);await writeFile(markerPath,canonicalJson(v),{mode:0o600});}
  else if(kind==="missing signed marker")await rm(markerPath);
  else if(kind==="symlink claim")await symlink(markerPath,claimPath);
  else await rm(join(f.temp.root,"jupiter-v1-claims",f.op.ownerProfileHash),{recursive:true});
  let keys=0;await assert.rejects(new JupiterHistoricalProjectionReader(f.temp.root,{load:async()=>{keys++;return Buffer.alloc(32,77);},create:async()=>{throw Error();}}).read(ea25));assert.equal(keys,0);
 });
}
for(const kind of ["claim appears","claim appears then disappears","claim directory replaced","root replaced","signed marker changed","authenticated hash mismatch","bad authenticated signature"]){
 const title=`exact ea25 signed-only rejects ${kind} after genuine TEST consent`;
 test(title,async()=>inPty(title,async()=>{
  const f=await historicalFixture({operationId:ea25,omitClaim:true, ...(kind==="bad authenticated signature"?{mutateSealedEffect:(e:import("../../src/direct-rail-ports.js").RailSignedEffect)=>{const b=Buffer.from(e.rawPayload,"base64");b[1]=b[1]!^1;const rawPayload=b.toString("base64");return {...e,rawPayload,rawPayloadHash:sha256(rawPayload)};}}:{})});
  try{
   if(kind==="authenticated hash mismatch"){const path=join(f.temp.root,"jupiter-v1-signatures",f.op.ownerProfileHash,`${ea25}.json`),v=JSON.parse(await readFile(path,"utf8"));v.rawPayloadHash="f".repeat(64);const {recordHash:_,...body}=v;v.recordHash=domainHash(v.schemaVersion,canonicalJson(body));await writeFile(path,canonicalJson(v),{mode:0o600});}
   let keys=0;const reader=new JupiterHistoricalProjectionReader(f.temp.root,{load:async()=>{keys++;
    const dir=join(f.temp.root,"jupiter-v1-claims",f.op.ownerProfileHash),path=join(dir,`${ea25}.json`);
    if(kind.startsWith("claim appears")){await f.bindings.claim(f.op,f.binding,f.effect,new Date());if(kind.endsWith("disappears"))await rm(path);}
    else if(kind==="claim directory replaced"){await rename(dir,join(f.temp.base,"retained-claims"));await mkdir(dir,{mode:0o700});}
    else if(kind==="root replaced"){await rename(f.temp.root,join(f.temp.base,"retained-root"));await mkdir(f.temp.root,{mode:0o700});}
    else if(kind==="signed marker changed"){const marker=join(f.temp.root,"jupiter-v1-signatures",f.op.ownerProfileHash,`${ea25}.json`),v=JSON.parse(await readFile(marker,"utf8"));v.rawPayloadHash="f".repeat(64);const {recordHash:_,...body}=v;v.recordHash=domainHash(v.schemaVersion,canonicalJson(body));await writeFile(marker,canonicalJson(v),{mode:0o600});}
    return Buffer.alloc(32,77);
   },create:async()=>{throw Error();}});
   await assert.rejects(reader.read(ea25));assert.equal(keys,1);
  }finally{await f.temp.cleanup();}
 }));
}

test("production absent-mode original marker anchor refuses generated self-consistent TEST signature",async t=>{
 const f=await historicalFixture({operationId:ea25,omitClaim:true});t.after(f.temp.cleanup);const reader=new HistoricalBindingReader(f.temp.root);
 const retained=await reader.retainedEvidence(f.op,f.binding);await assert.rejects(reader.assertOriginalAbsentSignedMarker(f.op,retained));
 let keys=0;await assert.rejects(new FixedHistoricalAuthenticator(f.temp.root,{load:async()=>{keys++;return Buffer.alloc(32,77);},create:async()=>{throw Error();}}).authenticate(ea25));assert.equal(keys,0);
});
test("production original marker anchor leaves present-claim legacy route unpinned",async t=>{
 const f=await historicalFixture({operationId:ea25});t.after(f.temp.cleanup);const reader=new HistoricalBindingReader(f.temp.root),retained=await reader.retainedEvidence(f.op,f.binding);
 assert.equal(retained.evidence.kind,"retained_send_claim_present");await reader.assertOriginalAbsentSignedMarker(f.op,retained);
});
