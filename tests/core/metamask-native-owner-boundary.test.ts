import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedContextCurrent,
  runFixedMetaMaskNativeTransfer, readFixedMetaMaskNativeTransfer, readMetaMaskNativeSettlement,
  type MetaMaskNativeOwnedScope, type MetaMaskNativeOwnedContext } from "../../src/metamask-native-transfer-owner.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { parseCatalogArgv } from "../../src/command-catalog.js";

const scope = Object.freeze({}) as MetaMaskNativeOwnedScope;
const context = Object.freeze({}) as MetaMaskNativeOwnedContext;
test("public DTOs, clones and arbitrary empty objects cannot claim or assert foreground owner authority", async()=>{
  for(const candidate of [scope, structuredClone(scope), {context}, null]) {
    assert.throws(()=>claimMetaMaskNativeOwnedScope(candidate as MetaMaskNativeOwnedScope,context), /scope/);
    assert.throws(()=>assertMetaMaskNativeOwnedScope(candidate as MetaMaskNativeOwnedScope,context), /scope/);
    await assert.rejects(()=>assertMetaMaskNativeOwnedContextCurrent(candidate as MetaMaskNativeOwnedScope,context), /scope/);
  }
});
test("finite normal command rejects arbitrary chains before any state or provider read",async()=>{
  for(const chain of [0,8453,42161,NaN,Infinity,1.5]) await assert.rejects(()=>runFixedMetaMaskNativeTransfer("/does-not-exist",chain,"fixed-0001"),/fixed MetaMask/);
});
test("settlement and reserve do not accept forged operation identities or a quote DTO",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"apn-native-boundary-")));
  try {
    const ledger=new AssetUsageLedger(root), id="1".repeat(64);
    await assert.rejects(()=>ledger.reserveMetaMaskNative(id,"native",new Date()),/normal journal/);
    await assert.rejects(()=>ledger.settleMetaMaskNativeActual(id,new Date()),/settlement is absent/);
    await assert.rejects(()=>readMetaMaskNativeSettlement(root,id),/settlement is absent/);
    await assert.rejects(()=>readFixedMetaMaskNativeTransfer(root,id),/does not exist/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test("fixed CLI rejects caller custody, recipient, token, RPC and raw transaction parameters",()=>{
  const base=["wallet","metamask","native-transfer","--chain-id","1","--idempotency-key","native-0001"];
  for(const flag of ["--profile","--recipient","--token","--raw-tx","--rpc-url","--wallet"]) assert.throws(()=>parseCatalogArgv([...base,flag,"arbitrary"]));
});
