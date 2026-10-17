import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedContextCurrent,
  runMetaMaskNativeTransfer, readMetaMaskNativeTransfer, readMetaMaskNativeSettlement,
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
const RECIPIENT="0x5555555555555555555555555555555555555555";
const request=(change:Record<string,unknown>={})=>({profile:"mm-owned-test",chainId:1,recipient:RECIPIENT,amountAtomic:"2500",idempotencyKey:"native-0001",...change});
test("the command rejects other chains, recipients and amounts before any state or provider read",async()=>{
  for(const chainId of [0,8453,42161,NaN,Infinity,1.5]) await assert.rejects(()=>runMetaMaskNativeTransfer("/does-not-exist",request({chainId}) as never),/Ethereum, Optimism, Monad, Linea and Sei/);
  for(const recipient of ["0x0000000000000000000000000000000000000000","0x555","not-an-address","So11111111111111111111111111111111111111112"])
    await assert.rejects(()=>runMetaMaskNativeTransfer("/does-not-exist",request({recipient}) as never),{code:"APN_INVALID_INPUT"});
  for(const amountAtomic of ["0","01","1.5","-1","",`1${"0".repeat(78)}`]) await assert.rejects(()=>runMetaMaskNativeTransfer("/does-not-exist",request({amountAtomic}) as never),{code:"APN_INVALID_INPUT"});
});
test("settlement and reserve do not accept forged operation identities or a quote DTO",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"apn-native-boundary-")));
  try {
    const ledger=new AssetUsageLedger(root), id="1".repeat(64);
    await assert.rejects(()=>ledger.reserveMetaMaskNative(id,"native",new Date()),/normal journal/);
    await assert.rejects(()=>ledger.settleMetaMaskNativeActual(id,new Date()),/settlement is absent/);
    await assert.rejects(()=>readMetaMaskNativeSettlement(root,id),/settlement is absent/);
    await assert.rejects(()=>readMetaMaskNativeTransfer(root,id),/does not exist/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test("native CLI requires profile, recipient and amount, and rejects token, RPC and raw transaction parameters",()=>{
  const base=["wallet","metamask","native-transfer","--profile","mm-owned-test","--chain","ethereum","--recipient",RECIPIENT,"--amount-atomic","2500","--idempotency-key","native-0001"];
  assert.deepEqual(bindArgv(base).request,{command:"wallet.metamask.native-transfer",...request()});
  for(const flag of ["--profile","--recipient","--amount-atomic"]) {const at=base.indexOf(flag);assert.throws(()=>bindArgv([...base.slice(0,at),...base.slice(at+2)]));}
  for(const flag of ["--token","--raw-tx","--rpc-url","--wallet"]) assert.throws(()=>parseCatalogArgv([...base,flag,"arbitrary"]));
  for(const amount of ["0","1.5","-1"]) assert.throws(()=>bindArgv([...base.slice(0,9),amount,...base.slice(10)]));
});

test("normal central EVM guard reads existing native journals only and cannot hide malformed financial state",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"apn-native-central-read-")));
  try {
    const state=new StateStore(root),operations=new OperationService(state),profileHash=state.profileHash("native-test-alias"),payer="0xf41170df51aab52aaa04fbc3ff325cf051644aca";
    await operations.assertEvmAccountAvailable(profileHash,1,payer);
    assert.deepEqual(await readdir(root),[]);
    // The owner's own-journal exclusion names an exact operation id; a malformed id is refused before any read.
    await assert.rejects(()=>operations.assertEvmAccountAvailableExcept(profileHash,1,payer,"not-an-operation-id"),{code:"APN_INVALID_INPUT"});
    await mkdir(join(root,"metamask-native-operations"),{mode:0o700});
    await writeFile(join(root,"metamask-native-operations",`${"a".repeat(64)}.json`),JSON.stringify({schemaVersion:"forged"}),{mode:0o600});
    await assert.rejects(()=>operations.assertEvmAccountAvailable(profileHash,1,payer),{code:"APN_STATE_CORRUPT"});
    await assert.rejects(()=>operations.assertEvmAccountAvailable(profileHash,59144,payer),{code:"APN_STATE_CORRUPT"});
    assert.deepEqual(await readdir(root),["metamask-native-operations"]);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("public chain names bind intrinsically and reject numeric IDs or aliases",()=>{
  const argv=(chain:string)=>["wallet","metamask","native-transfer","--profile","mm-owned-test","--chain",chain,"--recipient",RECIPIENT,"--amount-atomic","2500","--idempotency-key","native-0001"];
  for (const [name,chainId] of Object.entries({ethereum:1,optimism:10,monad:143,linea:59144,sei:1329})) {
    assert.deepEqual(bindArgv(argv(name)).request,{command:"wallet.metamask.native-transfer",...request({chainId})});
  }
  for (const name of ["1","10","143","59144","1329","base","eth","Ethereum","eip155:1","arbitrum"]) assert.throws(()=>bindArgv(argv(name)));
  assert.throws(()=>bindArgv(["wallet","metamask","native-transfer","--profile","mm-owned-test","--chain-id","1","--recipient",RECIPIENT,"--amount-atomic","2500","--idempotency-key","native-0001"]));
});
