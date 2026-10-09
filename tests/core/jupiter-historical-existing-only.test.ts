import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, readdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { historicalFixture } from "./jupiter-historical-authentication-fixture.js";
import { temporaryState } from "./helpers.js";
import { SavedJupiterV1MaterialStore } from "../../src/swap/jupiter-solana/v1-material.js";
import { JupiterV1ExecutionBindingStore } from "../../src/swap/jupiter-solana/v1-effects.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { HistoricalMaterialReader, HistoricalBindingReader, HistoricalCustodyReader, HistoricalReadState, existingHistoricalRoot } from "../../src/swap/jupiter-solana/historical-authentication-readers.js";

type Fixture = Awaited<ReturnType<typeof historicalFixture>>;
const kinds = ["material", "binding", "custody"] as const;
function finite(kind: typeof kinds[number], root: string, f: Fixture, onKey: () => void) {
  const wrapping = {load:async()=>{onKey();return Buffer.alloc(32,77);},create:async()=>{throw Error("no creation");}};
  if (kind === "material") { const r = new HistoricalMaterialReader(root); return {initialize:()=>r.initialize(), read:()=>r.load(f.op.quote.quoteHash)}; }
  if (kind === "binding") { const r = new HistoricalBindingReader(root); return {initialize:()=>r.initialize(), read:()=>r.load(f.op,f.prepared)}; }
  const r = new HistoricalCustodyReader(root,wrapping); return {initialize:()=>r.initialize(), read:()=>r.effect(f.account,f.op.operationId,f.binding.bindingHash)};
}
for (const kind of kinds) test(`ordinary ${kind} default readiness still initializes missing owned TEST root`,async t=>{
  const f=await historicalFixture(), target=await temporaryState();t.after(f.temp.cleanup);t.after(target.cleanup);
  if(kind==="material")assert.equal(await new SavedJupiterV1MaterialStore(target.root).load(f.op.quote.quoteHash),null);
  else if(kind==="binding")assert.equal(await new JupiterV1ExecutionBindingStore(target.root).load(f.op,f.prepared),null);
  else assert.equal(await new ChainAccountStore(target.root,{load:async()=>{throw Error("no key");},create:async()=>{throw Error("no key");}}).account("solana-local","solana"),null);
  assert.equal((await lstat(target.root)).isDirectory(),true);assert.equal((await lstat(join(target.root,"locks"))).isDirectory(),true);
});
for (const kind of kinds) test(`finite ${kind} missing TEST root never initializes or loads key`,async t=>{
  const f=await historicalFixture(),target=await temporaryState();t.after(f.temp.cleanup);t.after(target.cleanup);let keys=0;
  const r=finite(kind,target.root,f,()=>keys++);await assert.rejects(r.read());await assert.rejects(r.initialize());
  await assert.rejects(lstat(target.root),{code:"ENOENT"});assert.deepEqual(await readdir(target.base),[]);assert.equal(keys,0);
});
for (const kind of kinds) for(const replacement of ["disappeared","replaced","symlink"] as const) test(`finite ${kind} ${replacement} TEST root fails without recreating domain or loading key`,async t=>{
  const f=await historicalFixture();t.after(f.temp.cleanup);let keys=0;const r=finite(kind,f.temp.root,f,()=>keys++);
  await existingHistoricalRoot(f.temp.root);await r.initialize();const moved=join(f.temp.base,"retained-root");await rename(f.temp.root,moved);
  if(replacement==="replaced")await mkdir(f.temp.root,{mode:0o700});
  if(replacement==="symlink")await symlink(moved,f.temp.root);
  await assert.rejects(r.read());assert.equal(keys,0);
  if(replacement==="disappeared")await assert.rejects(lstat(f.temp.root),{code:"ENOENT"});
  else if(replacement==="replaced")assert.deepEqual(await readdir(f.temp.root),[]);
  else assert.equal((await lstat(f.temp.root)).isSymbolicLink(),true);
  assert.equal((await lstat(join(moved,"chain-wallets","solana"))).isDirectory(),true);
});
for (const kind of kinds) test(`finite ${kind} cached readiness still rejects replaced TEST root`,async t=>{
  const f=await historicalFixture();t.after(f.temp.cleanup);let keys=0;const r=finite(kind,f.temp.root,f,()=>keys++);await r.read();const before=keys;
  await rename(f.temp.root,join(f.temp.base,"retained-root"));await mkdir(f.temp.root,{mode:0o700});
  await assert.rejects(r.read());assert.equal(keys,before);assert.deepEqual(await readdir(f.temp.root),[]);
});
for (const change of ["root disappeared","root replaced","root symlink","locks disappeared","locks replaced","locks symlink"] as const) test(`finite advisory path ${change} does not initialize or enter action`,async t=>{
  const f=await historicalFixture();t.after(f.temp.cleanup);const state=new HistoricalReadState(f.temp.root);await state.initialize();let entered=0;
  const path=change.startsWith("root")?f.temp.root:join(f.temp.root,"locks"), moved=join(f.temp.base,"retained-directory");await rename(path,moved);
  if(change.endsWith("replaced"))await mkdir(path,{mode:0o700});
  if(change.endsWith("symlink"))await symlink(moved,path);
  await assert.rejects(state.withLocks(["profile:historical-existing-only"],async()=>{entered++;}));assert.equal(entered,0);
  if(change.endsWith("disappeared"))await assert.rejects(lstat(path),{code:"ENOENT"});
  else if(change.endsWith("replaced"))assert.deepEqual(await readdir(path),[]);
  else assert.equal((await lstat(path)).isSymbolicLink(),true);
});
test("finite advisory files allowed only inside already-existing pinned TEST locks directory",async t=>{
  const f=await historicalFixture();t.after(f.temp.cleanup);const state=new HistoricalReadState(f.temp.root);await state.initialize();const rootBefore=await lstat(f.temp.root),locksBefore=await lstat(join(f.temp.root,"locks"));let entered=0;
  await state.withLocks(["profile:historical-existing-only"],async()=>{entered++;});assert.equal(entered,1);
  assert.equal((await lstat(f.temp.root)).ino,rootBefore.ino);assert.equal((await lstat(join(f.temp.root,"locks"))).ino,locksBefore.ino);
  assert.equal((await readdir(join(f.temp.root,"locks"))).some(name=>name.endsWith(".lock")),true);
});

for (const kind of kinds) test(`finite ${kind} missing required TEST domain directory is not recreated`,async t=>{const f=await historicalFixture();t.after(f.temp.cleanup);let keys=0;const r=finite(kind,f.temp.root,f,()=>keys++);await r.initialize();const path=join(f.temp.root,kind==="material"?"jupiter-v1-quotes":kind==="binding"?"jupiter-v1-bindings":"chain-wallets");await rename(path,join(f.temp.base,"retained-domain"));await assert.rejects(r.read());assert.equal(keys,0);await assert.rejects(lstat(path),{code:"ENOENT"});});
