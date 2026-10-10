import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedContextCurrent,
  runFixedMetaMaskNativeTransfer, readFixedMetaMaskNativeTransfer, readMetaMaskNativeSettlement,
  type MetaMaskNativeOwnedScope, type MetaMaskNativeOwnedContext } from "../../src/metamask-native-transfer-owner.js";
import { StateStore } from "../../src/state.js";
import { OperationService } from "../../src/operation-service.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { bindArgv } from "../../src/command-binder.js";
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
  const base=["wallet","metamask","native-transfer","--chain","ethereum","--idempotency-key","native-0001"];
  for(const flag of ["--profile","--recipient","--token","--raw-tx","--rpc-url","--wallet"]) assert.throws(()=>parseCatalogArgv([...base,flag,"arbitrary"]));
});

test("normal central EVM guard reads existing native journals only and cannot hide malformed financial state",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"apn-native-central-read-")));
  try {
    const state=new StateStore(root),operations=new OperationService(state),profileHash=state.profileHash("native-test-alias"),payer="0xf41170df51aab52aaa04fbc3ff325cf051644aca";
    await operations.assertEvmAccountAvailable(profileHash,1,payer);
    assert.deepEqual(await readdir(root),[]);
    await assert.rejects(()=>operations.assertMetaMaskNativeOwnedAccountAvailable(scope,context),/scope/);
    await mkdir(join(root,"metamask-native-operations"),{mode:0o700});
    await writeFile(join(root,"metamask-native-operations",`${"a".repeat(64)}.json`),JSON.stringify({schemaVersion:"forged"}),{mode:0o600});
    await assert.rejects(()=>operations.assertEvmAccountAvailable(profileHash,1,payer),{code:"APN_STATE_CORRUPT"});
    await assert.rejects(()=>operations.assertEvmAccountAvailable(profileHash,59144,payer),{code:"APN_STATE_CORRUPT"});
    assert.deepEqual(await readdir(root),["metamask-native-operations"]);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("fixed public chain names bind intrinsically and reject numeric IDs or aliases",()=>{
  for (const [name,chainId] of Object.entries({ethereum:1,optimism:10,monad:143,linea:59144,sei:1329})) {
    assert.deepEqual(bindArgv(["wallet","metamask","native-transfer","--chain",name,"--idempotency-key","native-0001"]).request,
      {command:"wallet.metamask.native-transfer",chainId,idempotencyKey:"native-0001"});
  }
  for (const name of ["1","10","143","59144","1329","base","eth","Ethereum","eip155:1","arbitrum"])
    assert.throws(()=>bindArgv(["wallet","metamask","native-transfer","--chain",name,"--idempotency-key","native-0001"]));
  assert.throws(()=>bindArgv(["wallet","metamask","native-transfer","--chain-id","1","--idempotency-key","native-0001"]));
});
