import assert from "node:assert/strict";
import test from "node:test";
import { encodeEventTopics, encodeFunctionResult, parseAbi } from "viem";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { compileAllowlistPolicyOverlayV2 } from "../../src/allowlist-policy-v2.js";
import { reviewedWbtcPolicyAsset } from "../../src/canonical-wbtc-policy-assets.js";
import { assertBridgeRegistryListed } from "../../src/lifi/asset-listing.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { KeylessUniswapQuoteBuilder } from "../../src/swap/uniswap-v3/builder.js";
import { SavedUniswapQuoteStore } from "../../src/swap/uniswap-v3/material.js";
import { ETHEREUM_WBTC, UNISWAP_WBTC_MECHANISM_PIN, UNISWAP_WBTC_PROTOCOL_REGISTRY, UNISWAP_WBTC_CODE_PINS, UNISWAP_V3_KEYLESS_MECHANISM_PIN,
 UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, UNISWAP_V3_WBTC_WETH_3000 } from "../../src/swap/uniswap-v3/pins.js";
import { validateUniswapReceipt } from "../../src/swap/uniswap-receipt.js";
import { UNISWAP_ROUTER } from "../../src/swap/uniswap-pin.js";
import { createUniswapKeylessRuntime, REFUSING_SWAP_APPROVAL } from "../../src/swap/uniswap-v3/runtime-factory.js";
import { MemoryWrapping, keylessWallet, keylessPolicy } from "./uniswap-keyless-helpers.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { temporaryState } from "./helpers.js";
import { ACCOUNT, KeylessRpc, PROFILE } from "./uniswap-keyless-helpers.js";
const NOW = new Date("2026-10-09T03:00:00Z"), deadline = Math.floor(NOW.getTime()/1000)+900;
const request = {profile:PROFILE,account:ACCOUNT,recipient:ACCOUNT,outputToken:ETHEREUM_WBTC,amountAtomic:"400000000000000",slippageBps:50,
 ownerSlippageCapBps:100,deadline,maxGasLimit:"300000",maxFeePerGas:"30000000000",maxPriorityFeePerGas:"1000000000",now:NOW};
const POOL = parseAbi(["function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)","function liquidity() view returns(uint128)"]);
function rpc(quoted=1209n) {const base=new KeylessRpc();base.quoted=quoted;return { base, call:async(method:string,params:readonly unknown[])=>{
 if(method==='eth_call' && (params[0] as any).to===UNISWAP_V3_WBTC_WETH_3000){return (params[0] as any).data.startsWith('0x3850c7bd')?
 encodeFunctionResult({abi:POOL,functionName:'slot0',result:[45493679810323368769151825411638984n,265000,1,2,2,0,true]}):
 encodeFunctionResult({abi:POOL,functionName:'liquidity',result:1000000000000000000n});}return base.call(method,params);}};}
test('WBTC has separate mechanism/registry and strict owner supplemental identity',()=>{
 assert.notEqual(swapMechanismDigest(UNISWAP_WBTC_MECHANISM_PIN),swapMechanismDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN));
 assert.equal(UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY.registryDigest,'feb05302394daceec2edcef4c2839e4f557c92a461a26038064d11ea817f8953');
 assert.equal(swapMechanismDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN),'481d71eb7780b7f432ca0d476e58a2cad122303aa1be5bd73c75a3d1de1cf2e8');
 assert.equal(UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY.records.length,1);assert.equal(UNISWAP_WBTC_PROTOCOL_REGISTRY.records.length,1);
 const admission={chain:'eip155:1',kind:'token',identifier:ETHEREUM_WBTC,rail:'swap',mechanism:UNISWAP_WBTC_MECHANISM_PIN};
 assert.equal(reviewedWbtcPolicyAsset(admission)?.decimals,8);
 for(const patch of [{rail:'direct'},{chain:'eip155:8453'},{mechanism:UNISWAP_V3_KEYLESS_MECHANISM_PIN},{identifier:ETHEREUM_WBTC.toLowerCase()}])
 assert.equal(reviewedWbtcPolicyAsset({...admission,...patch}),undefined);
 const inventory=loadAllowlistInventory();assert.equal(inventory.assets.some(a=>a.symbol==='WBTC'),false);
 const compiled=compileAllowlistPolicyOverlayV2({overlayVersion:'wbtc.1',profile:PROFILE,accounts:{evm:ACCOUNT},datasetVersion:inventory.dataset.version,
 datasetSha256:inventory.dataset.sha256,inventorySha256:inventory.inventorySha256,effectiveAt:NOW.toISOString(),admissions:[
 {...admission,kind:'token',rail:'swap',maximumPerTransferAtomic:'2000',dailyLimitAtomic:'2000'}]});
 assert.equal(compiled.registry.chains[0]!.assets[0]!.decimals,8);assert.equal(compiled.overlay.datasetSha256,inventory.dataset.sha256);
});
test('legacy listing validates only exact canonical WBTC pins',()=>{
 assertBridgeRegistryListed(BRIDGE_ASSET_REGISTRY);
 const registry=structuredClone(BRIDGE_ASSET_REGISTRY) as any;registry[1].tokens.find((t:any)=>t.symbol==='WBTC').code.codeHash='0x'+'1'.repeat(64);
 assert.throws(()=>assertBridgeRegistryListed(registry),{code:'APN_INTERNAL'});
 const other=structuredClone(BRIDGE_ASSET_REGISTRY) as any;other[1].tokens[0].listing='legacy_pinned';assert.throws(()=>assertBridgeRegistryListed(other),{code:'APN_INTERNAL'});
});
test('WBTC bound quote uses 8 decimals and refuses sub-1000 slippage floor without sending',async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const quotes=new SavedUniswapQuoteStore(tmp.root);const good=rpc();
 const result:any=await new KeylessUniswapQuoteBuilder(good.call,quotes,async()=>UNISWAP_WBTC_CODE_PINS).quote(request);
 assert.equal(result.price.outputDecimals,8);assert.equal(result.quote.minimumOutputAtomic,'1203');assert.equal(result.mechanism.digest,swapMechanismDigest(UNISWAP_WBTC_MECHANISM_PIN));
 assert.equal((await quotes.load(result.quoteHash))?.quote.quoteHash,result.quoteHash);assert.equal(good.base.sends.length,0);
 await assert.rejects(new KeylessUniswapQuoteBuilder(rpc(1000n).call,quotes,async()=>UNISWAP_WBTC_CODE_PINS).quote({...request,ownerSlippageCapBps:10000}),(e:any)=>e.details?.reason==='uniswap_wbtc_output_floor');
 const envelope=result.unsignedTransaction, hash=('0x'+'a'.repeat(64)) as `0x${string}`, blockHash=('0x'+'b'.repeat(64)) as `0x${string}`;
 const topics=encodeEventTopics({abi:parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']),eventName:'Transfer',args:{from:UNISWAP_V3_WBTC_WETH_3000,to:ACCOUNT}});
 const evidence={transactionHash:hash,transaction:{hash,from:ACCOUNT,to:UNISWAP_ROUTER,input:envelope.data,value:request.amountAtomic,blockNumber:'100',blockHash},
 receipt:{transactionHash:hash,status:'0x1' as const,blockNumber:'100',blockHash,logs:[{address:ETHEREUM_WBTC,topics:topics as `0x${string}`[],data:('0x'+1209n.toString(16).padStart(64,'0')) as `0x${string}`}]},
 beforeNative:'1000000000000000',afterNative:'500000000000000',beforeOutput:'10',afterOutput:'1219',finalizedHead:{number:'101',hash:blockHash},observedAt:NOW.toISOString()};
 const expected={transactionHash:hash,account:ACCOUNT,recipient:ACCOUNT,inputAmountAtomic:request.amountAtomic,minimumOutputAtomic:'1203',outputToken:ETHEREUM_WBTC};
 assert.equal(validateUniswapReceipt(evidence,envelope,expected).finalized,true);
 assert.throws(()=>validateUniswapReceipt({...evidence,afterOutput:'1200'},envelope,expected),{code:'APN_OPERATION_BLOCKED'});
 assert.throws(()=>validateUniswapReceipt({...evidence,receipt:{...evidence.receipt,logs:[]}},envelope,expected),{code:'APN_OPERATION_BLOCKED'});
});

test('routing preserves old prepared operations and recovers WBTC by saved digest without sending',async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const wrapping=new MemoryWrapping();const state=await keylessWallet(tmp.root,wrapping,NOW);
 let policy=await keylessPolicy(NOW,new Date(deadline*1000));const base=new KeylessRpc();
 const runtime=createUniswapKeylessRuntime({state,wrapping,clock:{now:()=>NOW},policy:async()=>policy,foreground:REFUSING_SWAP_APPROVAL,call:base.call,verifyPins:async()=>[]});
 const old:any=await runtime.quote({...request,amountAtomic:'1000000000000000',outputToken:UNISWAP_USDC},NOW);
 const oldOp=await runtime.prepare({profile:PROFILE,quoteHash:old.quoteHash,idempotencyKey:'old-wbtc-routing-1'},NOW);
 const inventory=loadAllowlistInventory();policy=compileAllowlistPolicyOverlayV2({overlayVersion:'wbtc.2',profile:PROFILE,accounts:{evm:ACCOUNT},
 datasetVersion:inventory.dataset.version,datasetSha256:inventory.dataset.sha256,inventorySha256:inventory.inventorySha256,effectiveAt:NOW.toISOString(),admissions:[
 {chain:'eip155:1',kind:'native',rail:'swap',mechanism:UNISWAP_WBTC_MECHANISM_PIN,maximumPerTransferAtomic:request.amountAtomic,dailyLimitAtomic:request.amountAtomic},
 {chain:'eip155:1',kind:'token',identifier:ETHEREUM_WBTC,rail:'swap',mechanism:UNISWAP_WBTC_MECHANISM_PIN,maximumPerTransferAtomic:'2000',dailyLimitAtomic:'2000'}]}).registry;
 const good=rpc(), quotes=new SavedUniswapQuoteStore(tmp.root), quote:any=await new KeylessUniswapQuoteBuilder(good.call,quotes,async()=>UNISWAP_WBTC_CODE_PINS).quote(request);
 const op=await runtime.prepare({profile:PROFILE,quoteHash:quote.quoteHash,idempotencyKey:'wbtc-routing-1'},NOW);
 assert.equal(op.protocolRegistryDigest,UNISWAP_WBTC_PROTOCOL_REGISTRY.registryDigest);assert.equal(oldOp.protocolRegistryDigest,UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY.registryDigest);
 assert.equal((await runtime.status(oldOp.operationId,NOW)).integrityHash,oldOp.integrityHash);
 assert.equal((await runtime.status(op.operationId,NOW)).integrityHash,op.integrityHash);
 await assert.rejects(runtime.execute(op.operationId,NOW),{code:'APN_OPERATION_BLOCKED'});assert.equal(base.sends.length,0);
});
