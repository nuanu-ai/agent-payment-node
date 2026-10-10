import assert from "node:assert/strict";
import { appendFile, link, lstat, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hashObject, sha256, canonicalJson } from "../../src/canonical.js";
import { Cleanup86Custody } from "../../src/circle-v2-evm/cleanup86-custody.js";
import { Cleanup86SnapshotStore } from "../../src/circle-v2-evm/cleanup86-snapshot.js";
import type { Cleanup86FirstDispatchJournal } from "../../src/circle-v2-evm/cleanup86-first-dispatch-journal.js";
import { firstDispatchConsentedFixture } from "./cleanup86-first-dispatch-consent-fixture.js";
import { temporaryState } from "./helpers.js";

/** Standalone genuine /dev/tty TEMP driver, deliberately excluded from .test.js CPU suites.
 * TEST wire is a wrong Buyer signer; success means the precise safety refusal, never dispatch. */
const cases = ["baseline_wrong_signer", "hardlink_before_key", "inode_before_key", "inode_inside_keyload", "prototype_journal", "ciphertext_snapshot_drift", "wrong_wrapping_authentication", "actual_foreground_expiry"] as const;
for (const variant of cases) {
  const temp = await temporaryState();
  let callbackReached = false, keyReads = 0, materialReturned = false;
  let postCheck: (() => Promise<void>) | undefined;
  const startedAt = Date.now();
  console.log(`CASE_BEGIN ${variant}`);
  try {
    let error: unknown;
    try {
      await firstDispatchConsentedFixture(temp.root, async (f, journal, grant) => {
        callbackReached = true;
        const initial = await new Cleanup86SnapshotStore(temp.root).capture(f.parent.operationId);
        const materialPath = `${f.prefix}material.json`;
        const replace = async () => { const bytes = await readFile(materialPath); await rename(materialPath, join(temp.root, "TEST-old-material")); await writeFile(materialPath, bytes, { mode: 0o600 }); };
        const tuple = async () => {
          const rows: Record<string, unknown> = {};
          for (const name of Object.keys(initial.entries)) {
            const path = join(temp.root, "circle-cleanup85-recovery", name), s = await lstat(path);
            rows[name] = { sha256: sha256(await readFile(path)), dev:s.dev,ino:s.ino,uid:s.uid,mode:s.mode,nlink:s.nlink,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs };
          }
          return rows;
        };
        const originalSign = await readFile(`${f.prefix}sign.json`);
        if (variant === "hardlink_before_key") { await link(materialPath, join(temp.root,"TEST-material-alias")); assert.equal((await lstat(materialPath)).nlink,2); }
        if (variant === "inode_before_key") await replace();
        if (variant === "ciphertext_snapshot_drift") {
          const h = JSON.parse(await readFile(materialPath,"utf8")) as Record<string,string>;
          const bytes = Buffer.from(h.ciphertext!,"base64"); bytes[0] = bytes[0]!^1; h.ciphertext=bytes.toString("base64");bytes.fill(0);
          await writeFile(materialPath,canonicalJson(h)+"\n",{mode:0o600});
        }
        let afterInjection = await tuple();
        postCheck = async () => {
          assert.equal(hashObject(await tuple()),hashObject(afterInjection),"restore must not change any original tuple or bytes after the explicit injection");
          assert.deepEqual(await readFile(`${f.prefix}sign.json`),originalSign,"existing global SIGN remains immutable");
          await assert.rejects(readFile(`${f.prefix}send.json`),{code:"ENOENT"});
          await assert.rejects(readFile(`${f.prefix}first-dispatch-history-1.json`),{code:"ENOENT"});
        };
        const selected = variant === "prototype_journal" ? Object.create(Object.getPrototypeOf(journal)) as Cleanup86FirstDispatchJournal : journal;
        const custody = new Cleanup86Custody(f.state,{
          create:async()=>{throw Error("TEST forbidden key creation");},
          load:async()=>{
            keyReads++;
            if(variant === "inode_inside_keyload") { await replace(); afterInjection=await tuple(); }
            if(variant === "actual_foreground_expiry") await new Promise<void>(resolve=>setTimeout(resolve,60_100));
            return variant === "wrong_wrapping_authentication" ? Buffer.alloc(32,8) : Buffer.from(f.wrapping);
          },
        });
        const material = await custody.restoreFirstDispatch(f.parent,f.intent,f.recovery,grant,f.metadata,selected);
        materialReturned=true; return material;
      });
    } catch(caught) { error=caught; }
    if (!callbackReached) { const failure=String(error); console.error("PRE_CALLBACK_FAILURE "+failure); await appendFile("/tmp/cleanup86-custody-source19-consent-matrix-run1.pre-callback-failure.log",failure+"\n",{mode:0o600}); }
    assert.ok(callbackReached,"real foreground consent must reach the post-consent restore callback");
    assert.ok(error,"every case must refuse");assert.equal(materialReturned,false);
    const reason=(error as {details?:{reason?:string}}).details?.reason ?? String(error);
    const expected = variant === "baseline_wrong_signer" ? "cleanup86_restored_wire_binding" : variant === "wrong_wrapping_authentication" ? "cleanup86_material_authentication_failed" : variant === "actual_foreground_expiry" ? "private_cleanup86_first_dispatch_authority_required" : variant === "prototype_journal" ? "cleanup86_private_first_dispatch_journal_required" : variant === "hardlink_before_key" ? "State file must have exactly one link" : "cleanup86_snapshot_drift";
    assert.ok(reason.includes(expected),`precise refusal ${variant}: ${reason}`);
    assert.equal(keyReads,["baseline_wrong_signer","inode_inside_keyload","wrong_wrapping_authentication","actual_foreground_expiry"].includes(variant)?1:0);
    await postCheck!();
    const result = JSON.stringify({case:variant,result:"PASS_EXPECTED_REFUSAL",reason,keyReads,materialReturned,additionalSign:0,send:0,originalTupleAndBytesUnchangedAfterInjection:true,elapsedMs:Date.now()-startedAt});
    console.log(result); await appendFile("/tmp/cleanup86-custody-source19-consent-matrix-run2.results.jsonl",result+"\n",{mode:0o600});
  } finally { await temp.cleanup(); }
}
console.log("MATRIX_PASS 8/8 genuine /dev/tty consent; TEMP wrong-signer negative proof only");
