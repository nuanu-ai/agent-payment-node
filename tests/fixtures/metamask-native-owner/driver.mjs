// TEST ONLY: isolated pseudo-terminal, normal owner issuer and static peer fixtures. No real provider, HOME, RPC, keys or money.
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = pathToFileURL(process.argv[2] + '/');
const moduleUrl = name => new URL(name, base).href;
const payer='0xf41170df51aab52aaa04fbc3ff325cf051644aca', vendor='e3e44343da17c1912c2da0ce5b58f9c804b53d3715b8a2756c0b035fd50d288a';
let projectHash="d".repeat(64), effects=0, selectedQuote, lastScope, lastContext, beforeGuard=async()=>{};
const scenario=process.argv[3] ?? "positive";
await mock.module(moduleUrl('metamask-native-transfer-adapter.js'), {namedExports:{
  readFixedMetaMaskNativePolicy:async chain=>{if(chain===10)throw Error('TEST OP absent');return {selectedAddress:payer,vendorPolicyHash:vendor,policyBytes:866,tradingMode:'guard',vendorProjectHash:projectHash,observedAt:new Date().toISOString()};},
  readFixedMetaMaskNativeRequest:async(id,hash)=>{assert.equal(id,"TEST-pending-request");assert.equal(hash,projectHash);return {disposition:"acknowledged",transactionHash:"0x"+"e".repeat(64)};},
  submitOwnedMetaMaskNative:async(scope,context)=>{const owner=await import(moduleUrl('metamask-native-transfer-owner.js'));owner.claimMetaMaskNativeOwnedScope(scope,context);await owner.assertMetaMaskNativeOwnedContextCurrent(scope,context);lastScope=scope;lastContext=context;assert.throws(()=>owner.claimMetaMaskNativeOwnedScope(scope,context));assert.throws(()=>owner.assertMetaMaskNativeOwnedScope(structuredClone(scope),context));assert.throws(()=>owner.assertMetaMaskNativeOwnedScope(scope,structuredClone(context)));if(scenario==='project'){projectHash='a'.repeat(64);assert.notEqual(context.vendorProjectHash,projectHash);await assert.rejects(()=>owner.assertMetaMaskNativeOwnedContextCurrent(scope,context));}const {StateStore}=await import(moduleUrl('state.js'));await assert.rejects(()=>new StateStore(context.stateRoot).withLocks([`account-chain-nonce:${payer}:${context.quote.chainId}`],async()=>{}, {waitMs:100}),{code:"APN_STATE_BUSY"});await assert.rejects(()=>new StateStore(context.stateRoot).withLocks([`evm-owner:${payer}`],async()=>{}, {waitMs:100}),{code:"APN_STATE_BUSY"});effects++;await beforeGuard(context);if(scenario==='expired'||scenario==='custody')await assert.rejects(()=>owner.assertMetaMaskNativeOwnedContextCurrent(scope,context));if(scenario==='pending')return {disposition:'pending',requestId:'TEST-pending-request'};return ['positive','native-crosschain','alias-otherchain'].includes(scenario)?{disposition:'acknowledged',transactionHash:'0x'+'e'.repeat(64)}:{disposition:'unknown',reason:'TEST ambiguity',transactionHash:'0x'+'e'.repeat(64),requestId:'TEST-pending-request'};}
}});
await mock.module(moduleUrl('metamask-native-transfer-rpc.js'), {namedExports:{
  readFixedMetaMaskNativeNonce:async()=> '7',
  readFixedMetaMaskNativeBalances:async()=>({address:selectedQuote.sender,asset:{schemaVersion:'apn.evm-asset.v1',chainId:selectedQuote.chainId,kind:'erc20',address:selectedQuote.token,decimals:6,decimalsSource:'onchain'},nativeAtomic:scenario==='balance'?'0':'1000000000',assetAtomic:'10000',blockNumberAtomic:'100',blockHash:'0x'+'a'.repeat(64),rpcOrigin:'https://test-rpc.example',observedAt:new Date().toISOString()}),
  prepareFixedMetaMaskNativeQuote:async({chainId,maximumNativeFeeWei})=>{const {getAddress,encodeFunctionData}=await import('viem');const {hashObject}=await import(moduleUrl('canonical.js'));const {directEvmListRows}=await import(moduleUrl('evm-direct-networks.js'));const token=getAddress(directEvmListRows(chainId).find(r=>r.symbol==='USDC'&&r.kind==='token').identifier);const at=new Date().toISOString();const body={schemaVersion:'apn.metamask-native-fee-quote.v1',chainId,sender:getAddress(payer),token,tokenDecimals:6,seller:'0x991e254b5c8e0aaf6c244eaa2706bad059809b04',grossAtomic:'1000',netAtomic:'1000',tokenFeeAtomic:'0',nativeFeeCapAtomic:maximumNativeFeeWei,transaction:{type:2,to:token,data:encodeFunctionData({abi:[{type:'function',name:'transfer',stateMutability:'nonpayable',inputs:[{type:'address'},{type:'uint256'}],outputs:[{type:'bool'}]}],functionName:'transfer',args:[getAddress('0x991e254b5c8e0aaf6c244eaa2706bad059809b04'),1000n]}),valueAtomic:'0',nonceAtomic:'7',gasLimitAtomic:'65000',maxFeePerGasAtomic:'200',maxPriorityFeePerGasAtomic:'10',authorizationList:[]},feeQuote:{chainId,l1DataFeeUpperWei:'0',operatorFeeUpperWei:'0',maximumExecutionFeeWei:'13000000',totalQuoteWei:scenario==='fees'?'0':'13000000',totalFeeEnforcedOnchain:false,blockNumberAtomic:'100',blockHash:'0x'+'a'.repeat(64),rpcOrigin:'https://test-rpc.example',observedAt:at},expiresAt:new Date(Date.now()+60000).toISOString()};selectedQuote={...body,quoteHash:hashObject(body)};return selectedQuote;},
  observeFixedMetaMaskNativeTransfer:async(q,tx)=>{const {validateMetaMaskNativeFeeReceipt}=await import(moduleUrl('metamask-native-fee-evidence.js'));const evidence={schemaVersion:'apn.metamask-native-fee-receipt.v1',quoteHash:q.quoteHash,transactionHash:tx,chainId:q.chainId,sender:q.sender,to:q.transaction.to,valueAtomic:'0',transactionType:2,nonceAtomic:q.transaction.nonceAtomic,data:q.transaction.data,gasLimitAtomic:q.transaction.gasLimitAtomic,maxFeePerGasAtomic:q.transaction.maxFeePerGasAtomic,maxPriorityFeePerGasAtomic:q.transaction.maxPriorityFeePerGasAtomic,authorizationList:[],status:scenario==='reverted'?'reverted':'success',gasUsedAtomic:'50000',effectiveGasPriceAtomic:'150',receiptBlock:{numberAtomic:'101',hash:'0x'+'b'.repeat(64)},canonicalBlock:{numberAtomic:'101',hash:'0x'+'b'.repeat(64)},logs:[{address:q.token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+q.sender.slice(2).toLowerCase().padStart(64,'0'),'0x'+q.seller.slice(2).toLowerCase().padStart(64,'0')],data:'0x'+1000n.toString(16).padStart(64,'0')}],rpcOrigin:'https://test-rpc.example',observedAt:new Date().toISOString()};if(scenario==='reverted')evidence.logs=[];return {kind:'accepted',evidence,receipt:validateMetaMaskNativeFeeReceipt(evidence,q)};}
}});
const root=await realpath(await mkdtemp(join(tmpdir(),'apn-native-TEST-owner-')));
try {
 const {StateStore}=await import(moduleUrl('state.js'));
 const {metamaskDirectCapabilitySnapshot,capabilityHash,accountBindingHash}=await import(moduleUrl('provider-profile.js'));
 const {getAddress}=await import('viem');
 const state=new StateStore(root),profile='metamask-live-v042',address=getAddress(payer),caps=metamaskDirectCapabilitySnapshot();await state.initialize();
 await state.writeProviderProfile({schema_version:'apn.provider-profile.v1',profile,profile_hash:state.profileHash(profile),provider_id:'metamask-agent-wallet',public_address:address,account_binding_hash:accountBindingHash('metamask-agent-wallet',address),capability_snapshot:caps,capability_hash:capabilityHash(caps),revision:1,trust_class:'provider_managed_non_custodial_signer',observed_at:new Date().toISOString(),drift:{state:'bound',reason:'none'}});
 const {AllowlistPolicyStore}=await import(moduleUrl('allowlist-policy-store.js'));
 const policies=new AllowlistPolicyStore(root),token='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',at=new Date().toISOString();
 const record=await policies.stage({profile,now:new Date(),policy:{schemaVersion:'apn.allowlist-policy-file.v1',overlayVersion:'native-test-1',accounts:{evm:address},effectiveAt:at,admissions:[{chain:'eip155:1',kind:'native',rail:'direct',maximumPerTransferAtomic:'100000000',dailyLimitAtomic:'100000000'},{chain:'eip155:1',kind:'token',identifier:token,rail:'direct',maximumPerTransferAtomic:'10000',dailyLimitAtomic:'10000'},...(scenario==='native-crosschain'?[{chain:'eip155:1329',kind:'native',rail:'direct',maximumPerTransferAtomic:'100000000',dailyLimitAtomic:'100000000'},{chain:'eip155:1329',kind:'token',identifier:'0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392',rail:'direct',maximumPerTransferAtomic:'10000',dailyLimitAtomic:'10000'}]:[]),...(scenario==='op'?[{chain:'eip155:10',kind:'native',rail:'direct',maximumPerTransferAtomic:'100000000',dailyLimitAtomic:'100000000'}]:[])]}});
 const activation=await policies.appendDecision(profile,null,{status:'active',revision:record.revision,stagedRecordDigest:record.recordDigest,policyDigest:record.registry.policyDigest,registry:record.registry,approvalFingerprint:'a'.repeat(64),decidedAt:new Date().toISOString()});
 if(scenario==='expired')beforeGuard=async()=>{mock.timers.enable({apis:['Date'],now:Date.now()});mock.timers.tick(61000);};
 if(scenario==='custody')beforeGuard=async()=>{const current=await state.loadProviderProfile(state.profileHash(profile));await state.writeProviderProfile({...current,revision:2});};
 if(scenario==='policy')await policies.appendDecision(profile,activation.entryDigest,{status:'revoked',revision:record.revision,stagedRecordDigest:record.recordDigest,policyDigest:record.registry.policyDigest,approvalFingerprint:'b'.repeat(64),decidedAt:new Date().toISOString()});
 if(scenario==='wrongcustody'){const current=await state.loadProviderProfile(state.profileHash(profile));const wrong=getAddress('0x1111111111111111111111111111111111111111');await state.writeProviderProfile({...current,public_address:wrong,account_binding_hash:accountBindingHash('metamask-agent-wallet',wrong),revision:2});}
 if(['alias-samechain','alias-otherchain','sameprofile'].includes(scenario)){
   const {sealOperation,appendTransition}=await import(moduleUrl('state-integrity.js'));
   const alias=scenario==='sameprofile'?profile:'native-test-alias',hash=state.profileHash(alias),t=new Date().toISOString(),network=scenario==='alias-otherchain'?8453:1;
   if(alias!==profile){const current=await state.loadProviderProfile(state.profileHash(profile));await state.writeProviderProfile({...current,profile:alias,profile_hash:hash});}
   const tr={at:t,state:'awaiting_approval',terminal:false,reason:'prepared_provider_atomic_send',proofClass:'durable_provider_intent'};
   const {evmTransaction,evmDirectFingerprint}=await import(moduleUrl('evm-direct.js'));
   const asset={schemaVersion:'apn.evm-asset.v1',chainId:network,kind:'erc20',address:network===1?token:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',decimals:6,decimalsSource:'onchain'},recipient=getAddress('0x991e254b5c8e0aaf6c244eaa2706bad059809b04');
   const tx=evmTransaction(asset,address,recipient,'1'),economics={nonceAtomic:'7',gasLimitAtomic:'65000',maxFeePerGasAtomic:'200',maxPriorityFeePerGasAtomic:'10',maximumGasCostAtomic:'13000000'};
   const initial={schemaVersion:'apn.state.v1',operationId:state.operationId(alias,'native-conflict-test'),idempotencyHash:state.idempotencyHash('native-conflict-test'),profile:alias,profileHash:hash,requestHash:'6'.repeat(64),walletAddress:address,recipient,amountAtomic:'1',amountDecimal:'0.000001',chainId:network,token:asset.address,preparedAt:t,expiresAt:new Date(Date.now()+60000).toISOString(),state:tr.state,terminal:false,reason:tr.reason,proofClass:tr.proofClass,transitions:appendTransition([],tr),transactionData:tx.data,economics,preparedBlockNumberAtomic:'100',evm:{schemaVersion:'apn.evm-direct.v1',asset,transactionTo:tx.to,valueAtomic:tx.valueAtomic,maxFeeWei:'13000000',feeQuote:{chainId:network,l1DataFeeUpperWei:'0',operatorFeeUpperWei:'0',maximumExecutionFeeWei:'13000000',totalQuoteWei:'13000000',totalFeeEnforcedOnchain:false,blockNumberAtomic:'100',blockHash:'0x'+'a'.repeat(64),rpcOrigin:'https://test-rpc.example',observedAt:t}}};
   let saved=sealOperation({...initial,fingerprint:evmDirectFingerprint(initial)});
   await state.writeOperation(saved);
   const {integrityHash,...body}=saved,started={at:t,state:'started',terminal:false,reason:'provider_effect_started',proofClass:'durable_provider_no_replay'};
   await state.writeOperation(sealOperation({...body,state:started.state,reason:started.reason,proofClass:started.proofClass,transitions:appendTransition(saved.transitions,started)}));
 }
 const owner=await import(moduleUrl('metamask-native-transfer-owner.js'));
 if(['policy','wrongcustody','fees','balance','op','alias-samechain','sameprofile'].includes(scenario)){
   await assert.rejects(()=>owner.runFixedMetaMaskNativeTransfer(root,scenario==='op'?10:1,'native-test-refused-0001'));assert.equal(effects,0);process.stdout.write('TEST_OWNER_'+scenario.toUpperCase()+'_OK\n');
 } else {
 const result=await owner.runFixedMetaMaskNativeTransfer(root,1,'native-test-positive-0001');assert.equal(result.state,['positive','native-crosschain','alias-otherchain'].includes(scenario)?'acknowledged':'unknown');assert.equal(result.transaction_hash,scenario==='pending'?null:'0x'+'e'.repeat(64));assert.throws(()=>owner.assertMetaMaskNativeOwnedScope(lastScope,lastContext));
 const replay=await owner.runFixedMetaMaskNativeTransfer(root,1,'native-test-positive-0001');assert.equal(replay.operation_id,result.operation_id);assert.equal(effects,1);
 await assert.rejects(()=>owner.runFixedMetaMaskNativeTransfer(root,1,'native-test-second-key-0002'));assert.equal(effects,1);
 if(scenario==='native-crosschain'){const other=await owner.runFixedMetaMaskNativeTransfer(root,1329,'native-test-other-chain-0002');assert.equal(other.state,'acknowledged');assert.equal(effects,2);}
 const {OperationService}=await import(moduleUrl('operation-service.js')),normalOperations=new OperationService(state);
 for(const conflictProfile of [state.profileHash(profile),state.profileHash('native-test-unbound-alias')]){
   await assert.rejects(()=>normalOperations.assertEvmAccountAvailable(conflictProfile,1,address),{code:'APN_OPERATION_BLOCKED'});
   await normalOperations.assertEvmAccountAvailable(conflictProfile,59144,address);
 }
 await assert.rejects(()=>normalOperations.assertMetaMaskNativeOwnedAccountAvailable({},lastContext),{code:'APN_OPERATION_BLOCKED'});
 const {AssetUsageLedger,assetUsageReservationId}=await import(moduleUrl('asset-usage-ledger.js'));
 const {seal,withoutDigest}=await import(moduleUrl('asset-usage-ledger-record.js'));
 const ledger=new AssetUsageLedger(root),identity={account:address,chain:'eip155:1',asset:{kind:'native',identifier:null}};
 const reservationId=assetUsageReservationId(identity,`apn.metamask-native:${result.operation_id}:native`),held=(await ledger.usageWithReservation(identity,reservationId,new Date())).reservation;
 for(const phase of ['failed_before_effect','released_unsubmitted','failed_confirmed_revert','finalized'])await assert.rejects(()=>ledger.transition({...identity,reservationId,policyDigest:held.policyDigest,state:phase,now:new Date(),outcomeDigest:'1'.repeat(64)}));
 const buckets=await readdir(join(root,'asset-usage'));let holdPath;
 for(const bucket of buckets){const candidate=join(root,'asset-usage',bucket,`${reservationId}.json`);try{await readFile(candidate);holdPath=candidate;break;}catch{}}
 assert.ok(holdPath);const original=await readFile(holdPath),{metamaskNativeReservation,...stripped}=withoutDigest(held);
 await writeFile(holdPath,JSON.stringify(seal(stripped))+'\n');
 await assert.rejects(()=>ledger.transition({...identity,reservationId,policyDigest:held.policyDigest,state:'released_unsubmitted',now:new Date(),outcomeDigest:'2'.repeat(64)}));
 await writeFile(holdPath,original);
 const observed=await owner.readFixedMetaMaskNativeTransfer(root,result.operation_id,true);assert.equal(observed.state,scenario==='reverted'?'confirmed_reverted':'confirmed');assert.equal(observed.receipt.transferAccepted,scenario!=='reverted');assert.equal(observed.receipt.nativeFeeAtomic,'7500000');
 assert.equal((await ledger.usage({account:address,chain:'eip155:1',asset:{kind:'native',identifier:null}},new Date())).amountAtomic,'7500000');
 assert.equal((await ledger.usage({account:address,chain:'eip155:1',asset:{kind:'token',identifier:token}},new Date())).amountAtomic,scenario==='reverted'?'0':'1000');
 await owner.readFixedMetaMaskNativeTransfer(root,result.operation_id,true);assert.equal(effects,scenario==='native-crosschain'?2:1);
 await normalOperations.assertEvmAccountAvailable(state.profileHash('native-test-unbound-alias'),1,address);
 process.stdout.write('TEST_OWNER_'+scenario.toUpperCase()+'_OK\n');
 }
} finally {await rm(root,{recursive:true,force:true});mock.timers.reset();mock.restoreAll();}
