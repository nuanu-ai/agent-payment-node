import {mkdtemp,cp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {loadActiveAssetPolicyRegistry} from '@nuanu-ai/apn/dist/allowlist-active-policy.js';
import {StateStore} from '@nuanu-ai/apn/dist/state.js';
import {createMcpServer} from '@nuanu-ai/apn/dist/mcp-server.js';
import {createUniswapTokenRuntime} from '@nuanu-ai/apn/dist/swap/uniswap-v3/token-runtime-factory.js';
import {ETHEREUM_USDT,UNISWAP_V3_QUOTER_V2} from '@nuanu-ai/apn/dist/swap/uniswap-v3/pins.js';
import {UNISWAP_USDC} from '@nuanu-ai/apn/dist/swap/uniswap-pin.js';
const root=await mkdtemp('/private/tmp/apn-c309-current-policy-');
const EXPECTED_POLICY_DIGEST='dcdd15c939ae013dbb33d68746eb5c258f66691018c54f1e4eefb5312bb17a64';
try{
  const ownerRoot=process.env.APN_OWNER_STATE_ROOT;
  if(!ownerRoot) throw new Error('APN_OWNER_STATE_ROOT is required');
  for(const name of ['allowlist-policies','allowlist-activations']) await cp(join(ownerRoot,name),join(root,name),{recursive:true});
  const now=new Date(); const active=await loadActiveAssetPolicyRegistry(root,'evm-live-buyer',now);
  if(active===null) throw new Error('no active current policy');
  assert.equal(active.revision,8,'current owner policy revision changed; refresh the evidence');
  assert.equal(active.digest,EXPECTED_POLICY_DIGEST,'current owner policy digest changed; refresh the evidence');
  const chain=active.registry.chains.find(x=>x.chain==='eip155:1');
  assert.ok(chain,'Ethereum is absent from the active owner policy');
  const admitted=chain.assets.filter(x=>x.rails.swap).map(x=>({identifier:x.identifier,
    cap:x.railCaps.swap.maximumPerTransferAtomic,pin:x.mechanismPins.swap.protocolVersion})).sort((a,b)=>a.identifier.localeCompare(b.identifier));
  assert.deepEqual(admitted,[
    {identifier:UNISWAP_USDC,cap:'3000000',pin:'v3-swap-router-1'},
    {identifier:ETHEREUM_USDT,cap:'3000000',pin:'v3-swap-router-1'},
  ].sort((a,b)=>a.identifier.localeCompare(b.identifier)),'exact USDT and USDC swap admissions changed');
  let physical=0,logical=0,effects=0;const methods=[];
  const word=n=>`0x${n.toString(16).padStart(64,'0')}`;
  const value=(m,p)=>{methods.push(m);if(m==='eth_sendRawTransaction') effects++;
    if(m==='eth_chainId') return '0x1';
    if(m==='eth_getBlockByNumber') return {number:'0x64',hash:`0x${'b'.repeat(64)}`,baseFeePerGas:'0x0'};
    if(m==='eth_call'){const tx=p[0];if(tx.to===UNISWAP_V3_QUOTER_V2) return `0x${word(1000000n).slice(2)}${word(0n).slice(2)}${word(0n).slice(2)}${word(0n).slice(2)}`;
      if(tx.data.startsWith('0xdd62ed3e')) return word(0n);if(tx.data.startsWith('0x70a08231')) return word(2000000n);return '0x';}
    if(m==='eth_getBalance') return '0x100000';throw new Error(`unexpected ${m}`);};
  const call=async(m,p)=>{physical++;logical++;return value(m,p);};
  Object.defineProperties(call,{batch:{value:async(_r,items)=>{physical++;logical+=items.length;return items.map(x=>value(x.method,x.params));}},
    telemetry:{value:()=>({httpRequests:physical,httpAttempts:physical,logicalItems:logical})},effectAttempts:{value:()=>effects}});
  const state=new StateStore(root),secret=Buffer.alloc(32,19),wrapping={load:async()=>Buffer.from(secret),create:async()=>Buffer.from(secret)};
  const runtime=createUniswapTokenRuntime({state,wrapping,clock:{now:()=>now},call,foreground:'refuse',verifyPins:async()=>{}});
  const server=createMcpServer({stateRoot:root,uniswapTokenRuntime:runtime,clock:{now:()=>now}});
  const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);
  const client=new Client({name:'current-policy-no-money',version:'1'});await client.connect(ct);
  const args={profile:'evm-live-buyer',account:active.accounts.evm,to:active.accounts.evm,
    source_token:ETHEREUM_USDT,output_token:UNISWAP_USDC,amount:'1000000',minimum_output:'990000',approval_cap:'1000000',
    deadline:String(Math.floor(now.getTime()/1000)+600),max_approval_gas_limit:'100000',max_swap_gas_limit:'200000',
    max_cleanup_gas_limit:'100000',max_fee_per_gas:'2',max_priority_fee_per_gas:'1',max_native_debit:'800000'};
  const result=await client.callTool({name:'apn_swap_ethereum_uniswap_token_quote',arguments:args});
  const envelope=JSON.parse(result.content[0].text);
  await client.close();await server.close();
  assert.equal(envelope.ok,true,`current-owner MCP quote failed: ${JSON.stringify(envelope.error)}`);
  assert.equal(envelope.data?.expectedOutputAtomic,'1000000');
  assert.equal(physical,4,'current-owner quote physical RPC budget changed');
  assert.equal(logical,7,'current-owner quote logical RPC budget changed');
  assert.equal(effects,0);assert.equal(methods.includes('eth_sendRawTransaction'),false);
  console.log(JSON.stringify({at:now.toISOString(),revision:active.revision,digest:active.digest,
    expiresAt:active.registry.expiresAt,swapAssets:admitted,
    quote:{ok:envelope.ok,expectedOutputAtomic:envelope.data.expectedOutputAtomic,
      code:envelope.error?.code ?? null,reason:envelope.error?.details?.reason ?? null},
    rpc:{physical,logical,effects,methods}},null,2));
}finally{await rm(root,{recursive:true,force:true});}
