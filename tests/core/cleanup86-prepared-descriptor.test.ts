import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryState } from "./helpers.js";
import { canonicalJson, hashObject, sha256 } from "../../src/canonical.js";
import { Cleanup86SnapshotStore } from "../../src/circle-v2-evm/cleanup86-snapshot.js";
import { validateCleanup86Effect, type Cleanup86Intent } from "../../src/circle-v2-evm/cleanup86-store.js";
const parent="4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
/** These authentic PUBLIC bytes are read only into an isolated temporary root. This validates
 * the retained prepared descriptor shape/raw identities, not a caller-mintable execution grant. */
test("actual retained generation1 raw prepared descriptor has no financial material",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);await mkdir(join(temp.root,"circle-cleanup85-recovery"),{recursive:true,mode:0o700});
 for(const kind of ["intent","generation-1-intent","effect","history-0"]){const name=`${parent}-cleanup86-${kind}.json`,bytes=await readFile(new URL(`../fixtures/circle86-prepared-generation1/${name}`,import.meta.url));await writeFile(join(temp.root,"circle-cleanup85-recovery",name),bytes,{mode:0o600});}
 const snapshot=await new Cleanup86SnapshotStore(temp.root).capture(parent),entry=(kind:string)=>snapshot.entries[`${parent}-cleanup86-${kind}.json`]!;
 assert.equal(entry("intent").identity.sha256,"c142bd6b93d1c57d0cd818583ea3d087ee2707a86056da023fc8eae111504e27");
 assert.equal(entry("generation-1-intent").identity.sha256,"0e464023ecc1728e557a08df8a7944872e318017a555a7dc30559e0aed206f5c");
 const intent=entry("generation-1-intent").value as Cleanup86Intent;
 assert.equal(intent.intentHash,"6eec092c0d556abc98414e4a8f46aa63f99ad14dc69012664cfae4201db7f800");
 const effect=validateCleanup86Effect(entry("effect").value,intent);assert.deepEqual(effect,validateCleanup86Effect(entry("history-0").value,intent));
 assert.equal(effect.phase,"prepared");assert.equal(effect.sequence,0);assert.equal(effect.previousHash,null);assert.equal(effect.transactionHash,null);assert.equal(effect.materialHash,null);
 assert.equal(entry("effect").identity.sha256,"f6fd8aa86ff1ee2c33b704dd35e3b836b687d47e8b23029220f23b4306fb5367");
 assert.equal(sha256(Buffer.from(canonicalJson(effect)+"\n")),entry("effect").identity.sha256);
 assert.ok(Object.values(snapshot.entries).every(x=>x.identity.nlink===1&&x.identity.uid===process.getuid!()));
 for(const mutation of [{...effect,transactionHash:"0x"+"a".repeat(64)},{...effect,materialHash:"a".repeat(64)},{...effect,foreignFinancialField:true},{...effect,intentHash:"a".repeat(64)}])assert.throws(()=>validateCleanup86Effect(mutation,intent));
 // Even resealed financial phases are different descriptors, never this authentic prepared0.
 for(const phase of ["signing_started","unknown"] as const){const {effectHash:_h,...body}=effect,changed={...body,phase};assert.notEqual(hashObject({...changed,effectHash:hashObject(changed)}),hashObject(effect));}
});
