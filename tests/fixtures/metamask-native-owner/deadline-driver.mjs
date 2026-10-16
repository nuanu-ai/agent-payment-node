// TEST ONLY: isolated pseudo-terminal, normal owner issuer and static peer fixtures. No real provider, HOME, RPC, keys or money.
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = pathToFileURL(process.argv[2] + '/');
const moduleUrl = name => new URL(name, base).href;
const scenario=process.argv[3] ?? "positive",custom=scenario==='profile-static-positive';
const payer=custom?'0x1111111111111111111111111111111111111111':'0xf41170df51aab52aaa04fbc3ff325cf051644aca',profile=custom?'mm-owned-static':'metamask-live-v042', vendor='e3e44343da17c1912c2da0ce5b58f9c804b53d3715b8a2756c0b035fd50d288a';
let projectHash="d".repeat(64), effects=0, selectedQuote, lastScope, lastContext, beforeGuard=async()=>{};
const primaryChain=1, recipientInput='0x991e254b5c8e0aaf6c244eaa2706bad059809b04', amount='1000';
const temp=await realpath(await mkdtemp(join(tmpdir(),'apn-mm-deadline-TEST-'))),script=join(temp,'sdk.cjs'),log=join(temp,'children.jsonl');
const project='TEST-fixed-project';
const {sha256}=await import(moduleUrl('canonical.js'));projectHash=sha256(project);
const legacyPolicy="# Mimir Wallet Policy\nschema_version: 1\nwallet_address: \"0xf41170df51aab52aaa04fbc3ff325cf051644aca\"\n\naddresses:\n  allowlist:\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1329\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 137\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 143\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 59144\n    - address: \"0x823a3a5bab1186141b32fc65f8e25ca24c679ce7\"\n      chain_id: 8453\n  blocklist: []\n\nevm:\n  allowed_chains:\n    - 1\n    - 10\n    - 56\n    - 137\n    - 143\n    - 999\n    - 1329\n    - 4326\n    - 4663\n    - 8453\n    - 42161\n    - 43114\n    - 46630\n    - 59144\n    - 84532\n    - 11155111\n  outflow_limits_usd:\n    rolling_24h: 0.5\n";
const policy=custom?legacyPolicy.replace('wallet_address: "0xf41170df51aab52aaa04fbc3ff325cf051644aca"',`wallet_address: "${payer}"`):legacyPolicy;
let stateRoot,guardBalances=0,nonceReads=0;
const originalPackage=await import(moduleUrl('metamask-package.js'));
await mock.module(moduleUrl('metamask-package.js'),{namedExports:{...originalPackage,resolveMetaMaskBin:async()=>{
  if(stateRoot&&scenario==='resolver-late'){const files=await readdir(join(stateRoot,'metamask-native-operations')).catch(()=>[]);if(files.length){const op=JSON.parse(await readFile(join(stateRoot,'metamask-native-operations',files[0]),'utf8'));if(op.effectAttempts===1){mock.timers.enable({apis:['Date'],now:Date.now()});mock.timers.tick(61000);}}}return script;
}}});
await writeFile(script,`const fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');const payer=${JSON.stringify(payer)},policy=${JSON.stringify(policy)},project=${JSON.stringify(project)},scenario=${JSON.stringify(scenario)};let data;if(a[0]==='auth')data={authenticated:true,summary:{mode:'session',projectId:project}};else if(a[1]==='address')data={mode:'server',address:payer,chainNamespace:'evm'};else if(a[1]==='trading-mode')data={mode:'guard',address:payer};else if(a[1]==='policy')data={address:payer,policy};else if(a[1]==='requests')data={request:{pollingId:'TEST-pending-request',kind:'transaction',namespace:'evm',chainId:1},status:{txHash:'0x'+'e'.repeat(64),status:'CONFIRMED'}};else if(a[1]==='send-transaction'){if(scenario==='nonce-advanced')data={mode:'server',address:payer,status:'AWAITING_MFA',pollingId:'TEST-pending-request'};else if(scenario==='send-refused'){process.stderr.write(JSON.stringify({error:{code:'POLICY_REJECTED',message:'TEST secret must not escape'}}));process.stdout.write(JSON.stringify({_notice:{kind:'AWAITING_MFA',pollingId:'TEST-pending-request'}}));process.exitCode=1;}else data={mode:'server',address:payer,hash:'0x'+'e'.repeat(64),chainId:1,projectId:project};}else throw new Error('TEST unexpected fixed argv');if(data)process.stdout.write(JSON.stringify({ok:true,data}));`,{mode:0o600});
const balances=(q)=>({address:q.sender,asset:{schemaVersion:'apn.evm-asset.v1',chainId:q.chainId,kind:'erc20',address:q.token,decimals:6,decimalsSource:'onchain'},nativeAtomic:scenario==='balance'?'0':'1000000000',assetAtomic:'10000',blockNumberAtomic:'100',blockHash:'0x'+'a'.repeat(64),rpcOrigin:'https://test-rpc.example',observedAt:new Date().toISOString()});
await mock.module(moduleUrl('metamask-native-transfer-rpc.js'), {namedExports:{
  readMetaMaskNativeFunding:async(_chain,_sender,deadline)=>{guardBalances++;nonceReads++;if(deadline)assert.ok(Date.parse(typeof deadline==='string'?deadline:deadline.utcExpiresAt)>Date.now());if(scenario==='rpc-late'){assert.equal(deadline.utcExpiresAt,selectedQuote.expiresAt);mock.timers.enable({apis:['Date'],now:Date.now()});mock.timers.tick(61000);}const sent=(await readFile(log,'utf8')).includes('send-transaction');return {balances:balances(selectedQuote),nonceAtomic:scenario==='nonce-advanced'&&sent?'8':'7'};},
  prepareMetaMaskNativeQuote:async({chainId,maximumNativeFeeWei,sender,recipient,amountAtomic})=>{const {getAddress}=await import('viem');const {hashObject}=await import(moduleUrl('canonical.js'));const {metaMaskNativeTransferData,metaMaskNativeUsdc}=await import(moduleUrl('metamask-native-fee-evidence.js'));const token=metaMaskNativeUsdc(chainId);const at=new Date().toISOString();const body={schemaVersion:'apn.metamask-native-fee-quote.v2',chainId,sender:getAddress(sender),token,tokenDecimals:6,recipient,amountAtomic,nativeFeeCapAtomic:maximumNativeFeeWei,transaction:{type:2,to:token,data:metaMaskNativeTransferData(recipient,amountAtomic),valueAtomic:'0',nonceAtomic:'7',gasLimitAtomic:'65000',maxFeePerGasAtomic:'200',maxPriorityFeePerGasAtomic:'10',authorizationList:[]},feeQuote:{chainId,l1DataFeeUpperWei:chainId===10?'1000':'0',operatorFeeUpperWei:chainId===10?'100':'0',maximumExecutionFeeWei:'13000000',totalQuoteWei:scenario==='fees'?'0':chainId===10?'13001100':'13000000',totalFeeEnforcedOnchain:false,blockNumberAtomic:'100',blockHash:'0x'+'a'.repeat(64),rpcOrigin:'https://test-rpc.example',observedAt:at},expiresAt:new Date(Date.now()+60000).toISOString()};selectedQuote={...body,quoteHash:hashObject(body)};return {quote:selectedQuote,funding:{balances:balances(selectedQuote)}};},
  observeMetaMaskNativeTransfer:async(q,tx)=>{const {validateMetaMaskNativeFeeReceipt,metaMaskNativeQuoteTransfer}=await import(moduleUrl('metamask-native-fee-evidence.js'));const t=metaMaskNativeQuoteTransfer(q);const evidence={schemaVersion:'apn.metamask-native-fee-receipt.v1',quoteHash:q.quoteHash,transactionHash:tx,chainId:q.chainId,sender:q.sender,to:q.transaction.to,valueAtomic:'0',transactionType:2,nonceAtomic:q.transaction.nonceAtomic,data:q.transaction.data,gasLimitAtomic:q.transaction.gasLimitAtomic,maxFeePerGasAtomic:q.transaction.maxFeePerGasAtomic,maxPriorityFeePerGasAtomic:q.transaction.maxPriorityFeePerGasAtomic,authorizationList:[],status:scenario==='reverted'?'reverted':'success',gasUsedAtomic:'50000',effectiveGasPriceAtomic:'150',receiptBlock:{numberAtomic:'101',hash:'0x'+'b'.repeat(64)},canonicalBlock:{numberAtomic:'101',hash:'0x'+'b'.repeat(64)},logs:[{address:q.token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+q.sender.slice(2).toLowerCase().padStart(64,'0'),'0x'+t.recipient.slice(2).toLowerCase().padStart(64,'0')],data:'0x'+BigInt(t.amountAtomic).toString(16).padStart(64,'0')}],rpcOrigin:'https://test-rpc.example',observedAt:new Date().toISOString()};if(q.chainId===10)evidence.opStackFeeComponents={l1DataFeeAtomic:'500',operatorFeeAtomic:'50',receiptExtensionHash:'d'.repeat(64)};if(scenario==='reverted')evidence.logs=[];return {kind:'accepted',evidence,receipt:validateMetaMaskNativeFeeReceipt(evidence,q)};}
}});
const root=await realpath(await mkdtemp(join(tmpdir(),'apn-native-TEST-owner-')));stateRoot=root;
try {
 const {StateStore}=await import(moduleUrl('state.js'));
 const {metamaskDirectCapabilitySnapshot,capabilityHash,accountBindingHash}=await import(moduleUrl('provider-profile.js'));
 const {getAddress}=await import('viem');
 const state=new StateStore(root),address=getAddress(payer),caps=metamaskDirectCapabilitySnapshot();await state.initialize();
 await state.writeProviderProfile({schema_version:'apn.provider-profile.v1',profile,profile_hash:state.profileHash(profile),provider_id:'metamask-agent-wallet',public_address:address,account_binding_hash:accountBindingHash('metamask-agent-wallet',address),capability_snapshot:caps,capability_hash:capabilityHash(caps),revision:1,trust_class:'provider_managed_non_custodial_signer',observed_at:new Date().toISOString(),drift:{state:'bound',reason:'none'}});
 const {AllowlistPolicyStore}=await import(moduleUrl('allowlist-policy-store.js'));
 const policies=new AllowlistPolicyStore(root),token=primaryChain===10?'0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85':'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',at=new Date().toISOString();
 const record=await policies.stage({profile,now:new Date(),policy:{schemaVersion:'apn.allowlist-policy-file.v1',overlayVersion:'native-test-1',accounts:{evm:address},effectiveAt:at,admissions:[{chain:`eip155:${primaryChain}`,kind:'native',rail:'direct',maximumPerTransferAtomic:'100000000',dailyLimitAtomic:'100000000'},{chain:`eip155:${primaryChain}`,kind:'token',identifier:token,rail:'direct',maximumPerTransferAtomic:'10000',dailyLimitAtomic:'10000'},...(scenario==='native-crosschain'?[{chain:'eip155:1329',kind:'native',rail:'direct',maximumPerTransferAtomic:'100000000',dailyLimitAtomic:'100000000'},{chain:'eip155:1329',kind:'token',identifier:'0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392',rail:'direct',maximumPerTransferAtomic:'10000',dailyLimitAtomic:'10000'}]:[]),...(scenario==='op'?[{chain:'eip155:10',kind:'native',rail:'direct',maximumPerTransferAtomic:'100000000',dailyLimitAtomic:'100000000'}]:[])]}});
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
 const run=(chainId,key)=>owner.runMetaMaskNativeTransfer(root,{profile,chainId,recipient:recipientInput,amountAtomic:amount,idempotencyKey:key});
 if(['resolver-late','rpc-late'].includes(scenario)){
   // A deadline before the vendor child starts proves no hand-off: the marker closes as failed_before_effect (R4).
   await assert.rejects(()=>run(1,'native-test-static-0001'));
   const children=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(children.filter(a=>a[1]==='send-transaction').length,0);
   const files=await readdir(join(root,'metamask-native-operations')),journal=JSON.parse(await readFile(join(root,'metamask-native-operations',files[0]),'utf8'));
   assert.equal(journal.state,'failed_before_effect');assert.equal(journal.effectAttempts,1);
   const {AssetUsageLedger}=await import(moduleUrl('asset-usage-ledger.js'));const ledger=new AssetUsageLedger(root),address=getAddress(payer);
   assert.equal((await ledger.usage({account:address,chain:'eip155:1',asset:{kind:'native',identifier:null}},new Date())).amountAtomic,'0');
   assert.equal((await ledger.usage({account:address,chain:'eip155:1',asset:{kind:'token',identifier:token}},new Date())).amountAtomic,'0');
   const replay=await run(1,'native-test-static-0001');assert.equal(replay.state,'failed_before_effect');
   process.stdout.write('TEST_OWNER_'+scenario.toUpperCase()+'_OK\n');
   await rm(root,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});process.exit(0);
 }
 const result=await run(1,'native-test-static-0001');
 const children=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse),sent=children.filter(a=>a[1]==='send-transaction');
 assert.equal(result.effect_attempts,1);assert.equal(result.state,['send-refused','nonce-advanced'].includes(scenario)?'unknown':'acknowledged');
 assert.equal(sent.length,1);
 if(sent.length){const first=children.findIndex(a=>a[1]==='send-transaction');assert.equal(first,6,'three READs before consent and three in the one final guard before send');const payload=JSON.parse(sent[0][sent[0].indexOf('--payload')+1]);assert.equal(payload.nonce,'0x7');assert.equal(payload.gas,'0xfde8');assert.equal(payload.value,'0x0');assert.deepEqual(Object.keys(payload),['to','data','value','gas','nonce','maxFeePerGas','maxPriorityFeePerGas']);}
 const journalFile=join(root,'metamask-native-operations',result.operation_id+'.json'),bytes=await readFile(journalFile),journal=JSON.parse(bytes);
 assert.equal(journal.context.profile,profile);assert.equal(journal.context.quote.sender.toLowerCase(),payer);assert.equal(journal.effectAttempts,1);assert.ok(journal.diagnostic);assert.ok(!JSON.stringify(result).includes('TEST secret'));
 if(scenario==='send-refused'){assert.equal(journal.providerRequestId,'TEST-pending-request');assert.equal(result.diagnostic.providerCode,'policy');assert.equal(result.diagnostic.stage,'sdk_send');}
 const count=children.length,replay=await run(1,'native-test-static-0001');assert.deepEqual(replay,result);assert.deepEqual(await readFile(journalFile),bytes);assert.equal((await readFile(log,'utf8')).trim().split('\n').length,count);
 const {AssetUsageLedger}=await import(moduleUrl('asset-usage-ledger.js'));const ledger=new AssetUsageLedger(root);assert.equal((await ledger.usage({account:address,chain:'eip155:1',asset:{kind:'native',identifier:null}},new Date())).amountAtomic,'13000000');assert.equal((await ledger.usage({account:address,chain:'eip155:1',asset:{kind:'token',identifier:token}},new Date())).amountAtomic,'1000');
 await assert.rejects(()=>run(1,'native-test-second-0002'));
 if(scenario==='send-refused'){
   // Abandonment observes once first: the stored request resolves to a confirmed receipt, so nothing is released.
   const approvals=[];
   await assert.rejects(()=>owner.abandonMetaMaskNativeTransfer(root,result.operation_id,async i=>{approvals.push(i);},()=>new Date()),{code:'APN_OPERATION_BLOCKED'});
   const closed=await owner.abandonMetaMaskNativeTransfer(root,result.operation_id,async i=>{approvals.push(i);},()=>new Date(Date.now()+120000));
   assert.equal(closed.state,'confirmed');assert.equal(approvals.length,0);
 }
 if(scenario==='nonce-advanced'||custom){
   // The pending request is kept as returned; no owner guard re-reads the (advanced) nonce after the hand-off.
   if(!custom){assert.equal(journal.providerRequestId,'TEST-pending-request');assert.equal(result.transaction_hash,null);assert.notEqual(result.diagnostic.stage,'post_handoff');}
   const nonceBefore=nonceReads,balanceBefore=guardBalances;
   mock.timers.enable({apis:['Date'],now:Date.now()});mock.timers.tick(61000);
   const observed=await owner.readMetaMaskNativeTransfer(root,result.operation_id,true);assert.equal(observed.state,'confirmed');assert.equal(observed.transaction_hash,'0x'+'e'.repeat(64));assert.equal(observed.receipt.nativeFeeAtomic,'7500000');
   assert.equal(nonceReads,nonceBefore,'receipt reconciliation never reuses pre-send pending nonce');assert.equal(guardBalances,balanceBefore,'receipt reconciliation never requires old affordability');
   assert.equal((await ledger.usage({account:address,chain:'eip155:1',asset:{kind:'native',identifier:null}},new Date())).amountAtomic,'7500000');
   assert.equal((await ledger.usage({account:address,chain:'eip155:1',asset:{kind:'token',identifier:token}},new Date())).amountAtomic,'1000');
 }

 process.stdout.write('TEST_OWNER_'+scenario.toUpperCase()+'_OK\n');
} finally {await rm(root,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});mock.timers.reset();mock.restoreAll();}
