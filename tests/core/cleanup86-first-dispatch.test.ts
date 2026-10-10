import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,realpath,rm,unlink,writeFile,readFile,link } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { firstDispatchFixture } from "./cleanup86-first-dispatch-fixture.js";
import { Cleanup86FirstDispatchJournal,assertAuthenticatedCleanup86FirstDispatchJournal } from "../../src/circle-v2-evm/cleanup86-first-dispatch-journal.js";
import { assertCleanup86FirstDispatchGrant } from "../../src/circle-v2-evm/cleanup86-first-dispatch-authority.js";
import { withCleanup85FinancialScope } from "../../src/circle-cleanup85-financial-scope.js";
import { verifyCleanup86FirstDispatchPurpose,verifiedCleanup86FirstDispatchPurpose } from "../../src/circle-v2-evm/cleanup86-first-dispatch-purpose.js";
import { Cleanup86Store } from "../../src/circle-v2-evm/cleanup86-store.js";
import { Cleanup86SnapshotStore } from "../../src/circle-v2-evm/cleanup86-snapshot.js";
import { executeCleanup86FirstDispatch } from "../../src/circle-v2-evm/cleanup86-first-dispatch-controller.js";

for(const variant of ["canonical","missingSign","missingHistory","extraHistory","missingFailure","modifiedHistory0","hardlinkLegacy","send","rootAlias","hardlink","drift","forgedGrant","forgedJournal"] as const) test(`first-dispatch secure provenance ${variant}`,async()=> {
  const root=await realpath(await mkdtemp(join(tmpdir(),"apn-first-dispatch-")));try {
    const f=await firstDispatchFixture(root),path=(kind:string)=>`${f.prefix}${kind}.json`;
    if(variant==="missingSign")await unlink(path("sign"));
    if(variant==="missingHistory")await unlink(path("generation-2-history-1"));
    if(variant==="extraHistory")await f.put("generation-2-history-4",{});
    if(variant==="missingFailure")await unlink(path("first-failure"));
    if(variant==="modifiedHistory0")await f.put("generation-2-history-0",{});
    if(variant==="hardlinkLegacy")await link(path("intent"),join(root,"external-legacy-alias.json"));
    if(variant==="send")await f.put("send",{});
    if(variant==="rootAlias")await writeFile(join(root,`${f.parent.operationId}-cleanup86-send.json`),"{}",{mode:0o600});
    if(variant==="hardlink")await link(path("material"),join(root,"external-material-alias.json"));
    if(!["canonical","drift","forgedGrant","forgedJournal"].includes(variant)){await assert.rejects(Cleanup86FirstDispatchJournal.admit(root,f.parent,f.intent));return;}
    const journal=await Cleanup86FirstDispatchJournal.admit(root,f.parent,f.intent),binding={root,operationId:f.parent.operationId,intentHash:f.intent.intentHash,recoveryId:f.recovery.recoveryBinding,envelopeHash:f.intent.envelope.envelopeHash,...f.metadata};
    if(variant==="drift"){await writeFile(path("material"),await readFile(path("material")));await assert.rejects(journal.assertStable(),/snapshot_drift/);}
    if(variant==="forgedGrant")assert.throws(()=>assertCleanup86FirstDispatchGrant({kind:"cleanup86-first-dispatch-grant"},binding,"restore"),/authority_required/);
    if(variant==="forgedJournal")assert.throws(()=>assertAuthenticatedCleanup86FirstDispatchJournal(Object.create(Cleanup86FirstDispatchJournal.prototype),{kind:"cleanup86-first-dispatch-grant"},binding),/journal_required/);
  } finally {await rm(root,{recursive:true,force:true});}
});
for(const variant of ["consentRefused","consentExpired","postClaimFailure","oneSend","expiredHistoricalFreshActivation","crossDayUnresolvedConservativeFloor"] as const) test(`first-dispatch controller ordering ${variant} (TEST restoration port only)`,async()=> {
  const root=await realpath(await mkdtemp(join(tmpdir(),"apn-first-dispatch-")));try {
    const f=await firstDispatchFixture(root),journal=await Cleanup86FirstDispatchJournal.admit(root,f.parent,f.intent),binding={root,operationId:f.parent.operationId,intentHash:f.intent.intentHash,recoveryId:f.recovery.recoveryBinding,envelopeHash:f.intent.envelope.envelopeHash,...f.metadata};if(["expiredHistoricalFreshActivation","crossDayUnresolvedConservativeFloor"].includes(variant)){f.setClock(f.now()+(variant==="crossDayUnresolvedConservativeFloor"?93_600_000:7_200_000));await f.renew();}
    const originals=(await new Cleanup86SnapshotStore(root).capture(f.parent.operationId)).entries;let restores=0,sends=0;
    await withCleanup85FinancialScope(f.state,f.request,f.lineage.operationId,async scope=> {
      const token=await verifyCleanup86FirstDispatchPurpose(f.state,f.parent,f.recovery,f.intent,binding,f.proof,scope,f.now);
      if(["expiredHistoricalFreshActivation","crossDayUnresolvedConservativeFloor"].includes(variant)){const p=verifiedCleanup86FirstDispatchPurpose(token,binding);assert.ok(f.now()>Date.parse(f.intent.currentPurpose!.windowEndsAt!));assert.ok(p.policies.every(current=>current.activationDigest!==f.intent.currentPurpose!.policies.find(old=>old.profile===current.profile)!.activationDigest));assert.equal(Date.parse(p.windowEndsAt)-Date.parse(p.capturedAt),60_000);if(variant==="crossDayUnresolvedConservativeFloor")assert.ok(BigInt(p.nativeUsageAtomic)>=75_000_000_000_000n);}
      const action=executeCleanup86FirstDispatch(journal,token,binding,{
        confirm:async()=>{if(variant==="consentRefused")throw Error("TEST consent refusal");if(variant==="consentExpired")f.setClock(f.now()+60_000);},
        restore:async()=>{restores++;return f.material;},preflight:async()=>{},send:async()=>{sends++;if(!["oneSend","expiredHistoricalFreshActivation","crossDayUnresolvedConservativeFloor"].includes(variant))throw Error("TEST postclaim rejection");return f.material.transactionHash;}
      });
      if(["oneSend","expiredHistoricalFreshActivation","crossDayUnresolvedConservativeFloor"].includes(variant))await action;else await assert.rejects(action);
    });
    assert.equal(restores,["postClaimFailure","oneSend","expiredHistoricalFreshActivation","crossDayUnresolvedConservativeFloor"].includes(variant)?1:0);assert.equal(sends,["postClaimFailure","oneSend","expiredHistoricalFreshActivation","crossDayUnresolvedConservativeFloor"].includes(variant)?1:0);
    const after=(await new Cleanup86SnapshotStore(root).capture(f.parent.operationId)).entries;for(const [name,entry]of Object.entries(originals))assert.deepEqual(after[name],entry);
    await new Cleanup86Store(root).assertGeneration(f.parent,f.intent);
    await assert.rejects(Cleanup86FirstDispatchJournal.admit(root,f.parent,f.intent));
    if(["postClaimFailure","oneSend","expiredHistoricalFreshActivation","crossDayUnresolvedConservativeFloor"].includes(variant))assert.equal(JSON.parse(await readFile(`${f.prefix}send.json`,"utf8")).boundary,"send");
  } finally {await rm(root,{recursive:true,force:true});}
});
