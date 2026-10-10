import { observeHistoricalPaidCircle } from "./historical-paid-observe.js";
import { HISTORICAL_MONAD_OPERATION } from "./historical-paid-source.js";
import { readCircleMintFeeRecipient } from "./mint-fee-recipient.js";
import { decodeEventLog, encodeEventTopics, erc20Abi, getAddress, type Hex } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { listLocalWallets } from "../wallet-import-collision.js";
import type { StateStore } from "../state.js";
import type { BridgeHttps } from "../lifi/https.js";
import { CIRCLE_RECIPIENT, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { circleHex, circleRecord, circleUint, decodeCircleSource, verifyCircleApproval, verifyCircleAttestationSigners, circleAttesterConfigurationHash, type CircleObservation } from "./protocol.js";
import { verifyCircleDeployments } from "./preflight.js";
import { readCircleAttesters, readCircleDeployment } from "./rpc.js";
import { advanceCircle, circleBlocked, type CircleEffect, type CircleOperationV1 } from "./operation-model.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
import { CircleExternalRpc, CircleExternalRpcBudget } from "./external-rpc.js";
import { circleExternalHeader, decodeCircleExternalDestination, externalClaimKey, validateExternalFulfillment, type CircleExternalFulfillment } from "./external-proof.js";
import { CircleExternalStore } from "./external-store.js";
import { CircleEffectStore } from "./custody.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";

function publicLog(l:Record<string,unknown>){return {address:getAddress(String(l.address)),topics:l.topics,data:circleHex(l.data),blockHash:circleHex(l.blockHash,32),blockNumber:circleUint(l.blockNumber).toString(),transactionHash:circleHex(l.transactionHash,32),transactionIndex:circleUint(l.transactionIndex).toString(),logIndex:circleUint(l.logIndex).toString(),removed:l.removed};}
function canonicalTag(b:Record<string,unknown>){return {blockHash:circleHex(b.hash,32),requireCanonical:true as const};}
function sourceEnvelope(effect:CircleEffect,input:unknown):void {const t=circleRecord(input),e=effect.envelope;
  if(circleHex(t.hash,32)!==effect.transactionHash||circleUint(t.nonce).toString()!==e.nonceAtomic||circleUint(t.gas).toString()!==e.gasLimitAtomic||circleUint(t.maxFeePerGas).toString()!==e.maxFeePerGasAtomic||circleUint(t.maxPriorityFeePerGas).toString()!==e.maxPriorityFeePerGasAtomic||circleHex(t.input)!==e.data||getAddress(String(t.from))!==e.from||getAddress(String(t.to))!==e.to||circleUint(t.value)!==0n||circleUint(t.chainId)!==BigInt(e.chainId))circleBlocked("external_source_envelope_changed");}
function strongSource(observation:CircleObservation):void {circleExternalHeader(observation.canonicalBlock);circleExternalHeader(observation.recheckedBlock);circleExternalHeader(observation.finalityHead);
 const t=circleRecord(observation.transaction),r=circleRecord(observation.receipt),b=circleRecord(observation.canonicalBlock),i=circleUint(t.transactionIndex);
 if(circleUint(r.transactionIndex)!==i||!Array.isArray(b.transactions)||b.transactions[Number(i)]!==t.hash)circleBlocked("external_source_index_binding");}
async function noPrivate(state:StateStore,op:CircleOperationV1):Promise<void>{
  if(op.nonceRetirement!==undefined||op.usage.length!==5||op.effects.some(e=>["mint","cleanup"].includes(e.role)&&(e.phase!=="prepared"||e.transactionHash!==null||e.materialHash!==null||e.proof!==null))||op.transitions.some(t=>/^(mint|cleanup)_(signing|submission|material|submitted|fenced)/u.test(t.reason)))circleBlocked("external_owned_private_entry");
  await new CircleEffectStore(state.root,{load:async()=>{circleBlocked("external_private_wallet_forbidden");},create:async()=>{circleBlocked("external_private_wallet_forbidden");}}).assertExternalAbsent(op);
  if(await new CircleNonceRetirementStore(state.root).intent(op)!==null)circleBlocked("external_retirement_present");
  await assertEvmNativeCustody(state,op.profile,op.sourceCustody);await assertEvmNativeCustody(state,op.destinationProfile,op.destinationCustody);
}
async function notControlled(state:StateStore,caller:string):Promise<void>{
 for(const entry of await state.walletImportEntries())if(entry.isFile()&&!entry.isSymbolicLink()&&/^[a-z0-9][a-z0-9._-]{0,63}\.json$/u.test(entry.name)){
   const wallet=await state.loadWallet(state.profileHash(entry.name.slice(0,-5)));if(wallet===null)circleBlocked("external_public_wallet_identity_incomplete");
 }
 for(const wallet of await listLocalWallets(state))if(wallet.address.toLowerCase()===caller.toLowerCase())circleBlocked("external_caller_controlled");
 for(const entry of await state.profileImportEntries()){if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-f0-9]{64}$/u.test(entry.name))circleBlocked("external_profile_directory");const p=await state.loadProviderProfile(entry.name);if(p===null)circleBlocked("external_profile_disappeared");if(p.public_address.toLowerCase()===caller.toLowerCase())circleBlocked("external_caller_controlled");}
}
export async function adoptCircleExternalMint(state:StateStore,repo:CircleRepository,usage:CircleUsage,env:NodeJS.ProcessEnv,now:()=>number,https:Pick<BridgeHttps,"request">,id:string,txHash:Hex):Promise<CircleOperationV1>{
 if(id===HISTORICAL_MONAD_OPERATION)return observeHistoricalPaidCircle(state,repo,usage,env,now,https,id,txHash);
 const initial=await repo.load(id);if(initial===null)circleBlocked("external_operation_not_found");if(initial.destinationChain!==143)circleBlocked("external_monad_only");if(initial.source===null||initial.attestation===null)circleBlocked("external_verified_source_required");
 const key=externalClaimKey(initial),sourceKey=hashObject({sourceTransactionHash:initial.source.transactionHash,sourceMessageHash:initial.source.sourceMessageHash});
 await state.initialize();return state.withLocks([`profile:${initial.profileHash}`,`profile:${initial.destinationProfileHash}`,`custody:${initial.profileHash}`,`custody:${initial.destinationProfileHash}`,`operation:${id}`,`operation:idempotency:${initial.idempotencyHash}`,evmAddressLock(initial.sourceCustody.walletAddress),evmAddressLock(initial.destinationCustody.walletAddress),`circle-external-nonce:${key}`,`circle-external-message:${sourceKey}`],async()=>{
  let op=(await repo.load(id))!;await noPrivate(state,op);if(op.terminal){if(op.state!=="external_fulfilled"||op.externalFulfillment?.destinationReceipt.transactionHash!==txHash)circleBlocked("external_terminal_conflict");return op;}
  const route=circleRoute(op.destinationChain,op.destinationProfile),budget=new CircleExternalRpcBudget(now,now()+120000,https),source=new CircleExternalRpc(env.APN_ARBITRUM_RPC_URL??"https://arbitrum-one-rpc.publicnode.com",42161,budget),destination=new CircleExternalRpc(env[route.rpcEnvironment]??route.rpcDefault,op.destinationChain,budget);
  const approval=op.effects[0]!,burn=op.effects[1]!;if(approval.phase!=="confirmed"||burn.phase!=="confirmed"||approval.transactionHash===null||burn.transactionHash===null)circleBlocked("external_source_not_confirmed");
  const [approvalObservation,burnObservation,destinationObservation]=await Promise.all([source.observation(approval.transactionHash,"finalized"),source.observation(burn.transactionHash,"finalized"),destination.observation(txHash,"safe")]);
  if(approvalObservation===null||burnObservation===null||destinationObservation===null)circleBlocked("external_finality_unresolved");
  strongSource(approvalObservation);strongSource(burnObservation);sourceEnvelope(approval,approvalObservation.transaction);sourceEnvelope(burn,burnObservation.transaction);
  const approvalBlock=circleRecord(approvalObservation.canonicalBlock),sourceHead=circleRecord(burnObservation.finalityHead);
  const approvalProof=verifyCircleApproval(approvalObservation,false,String(await source.read(CIRCLE_SOURCE_TOKEN,"allowance",[CIRCLE_SOURCE_OWNER,CIRCLE_MESSENGER],canonicalTag(approvalBlock))));
  const sourceProof=decodeCircleSource(burnObservation,op.destinationChain);
  if(op.source===null||sourceProof.sourceMessageHash!==op.source.sourceMessageHash||sourceProof.blockHash!==op.source.blockHash||sourceProof.receiptHash!==op.source.receiptHash||approval.proof?.receiptHash!==approvalProof.receiptHash)circleBlocked("external_source_reorg");
  if(String(await source.read(CIRCLE_SOURCE_TOKEN,"allowance",[CIRCLE_SOURCE_OWNER,CIRCLE_MESSENGER],canonicalTag(sourceHead)))!=="0")circleBlocked("external_source_allowance");
  const proofOp={...op,source:sourceProof},destBlock=circleRecord(destinationObservation.canonicalBlock),parent=await destination.block(`0x${(circleUint(destBlock.number)-1n).toString(16)}`);
  const parentHash=circleExternalHeader(parent);if(parentHash!==circleHex(destBlock.parentHash,32))circleBlocked("external_parent_binding");
  const destinationHead=circleRecord(destinationObservation.finalityHead);circleExternalHeader(destinationHead);
  const [sourceDeploy,destinationDeploy,historicalDeploy]=await Promise.all([readCircleDeployment(source,op.destinationChain,sourceHead),readCircleDeployment(destination,op.destinationChain,destinationHead),readCircleDeployment(destination,op.destinationChain,destBlock)]);
  verifyCircleDeployments(sourceDeploy,destinationDeploy);const historicalDeploymentDigest=verifyCircleDeployments(sourceDeploy,historicalDeploy);
  const attesters=await readCircleAttesters(destination,historicalDeploymentDigest,destBlock),signers=await verifyCircleAttestationSigners(op.attestation!,op.attestation!.attestation,attesters);
  if(circleAttesterConfigurationHash(attesters)!==op.attestation!.attesterConfigurationHash||hashObject(signers)!==hashObject(op.attestation!.signers))circleBlocked("external_frozen_attester_configuration_changed");
  const used=await destination.read(CIRCLE_TRANSMITTER,"usedNonces",[op.attestation!.nonce],canonicalTag(destBlock));
  const feeRecipient=BigInt(op.attestation!.feeExecutedAtomic)>0n?await readCircleMintFeeRecipient(destination,destinationObservation):undefined;
  const external=await decodeCircleExternalDestination(proofOp,destinationObservation,used,feeRecipient);if(external.transactionHash!==txHash)circleBlocked("external_exact_txhash");await notControlled(state,external.caller);
  const [before,after,tokenLogs]=await Promise.all([destination.read(route.token,"balanceOf",[CIRCLE_RECIPIENT],canonicalTag(parent)),destination.read(route.token,"balanceOf",[CIRCLE_RECIPIENT],canonicalTag(destBlock)),destination.call("eth_getLogs",[{address:route.token,blockHash:external.blockHash,topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer"})}])]);
  if(circleUint(String(after))-circleUint(String(before))!==BigInt(op.attestation!.receivedAtomic)||!Array.isArray(tokenLogs)||tokenLogs.length>256)circleBlocked("external_recipient_delta");
  const allTokenLogs=tokenLogs.map(circleRecord);
  for(const l of allTokenLogs)if(getAddress(String(l.address))!==route.token||circleHex(l.blockHash,32)!==external.blockHash||circleUint(l.blockNumber)!==BigInt(external.blockNumberAtomic)||l.removed!==false)circleBlocked("external_block_token_log_binding");
  const relevant=allTokenLogs.filter(l=>{const d=decodeEventLog({abi:erc20Abi,eventName:"Transfer",topics:l.topics as [Hex,...Hex[]],data:circleHex(l.data),strict:true});return d.args.from===CIRCLE_RECIPIENT||d.args.to===CIRCLE_RECIPIENT;});
  const expectedLog=(circleRecord(destinationObservation.receipt).logs as unknown[]).map(circleRecord).find(l=>{if(getAddress(String(l.address))!==route.token||!Array.isArray(l.topics)||l.topics[0]!==encodeEventTopics({abi:erc20Abi,eventName:"Transfer"})[0])return false;const d=decodeEventLog({abi:erc20Abi,eventName:"Transfer",topics:l.topics as [Hex,...Hex[]],data:circleHex(l.data),strict:true});return d.args.to===CIRCLE_RECIPIENT;});
  if(relevant.length!==1||expectedLog===undefined||canonicalJson(publicLog(relevant[0]!))!==canonicalJson(publicLog(expectedLog)))circleBlocked("external_block_delta_ambiguity");
  const [sourceAnchor,destAnchor]=await Promise.all([source.block(String(circleRecord(burnObservation.canonicalBlock).number)),destination.block(String(destBlock.number))]);
  if(circleExternalHeader(sourceAnchor)!==sourceProof.blockHash||circleExternalHeader(destAnchor)!==external.blockHash)circleBlocked("external_reanchor_changed");budget.assert();await noPrivate(state,op);
  const {caller,...destinationReceipt}=external;const body={schemaVersion:"apn.circle-external-fulfillment.v1" as const,operationId:op.operationId,fingerprint:op.fingerprint,sourceTransactionHash:sourceProof.transactionHash,sourceMessageHash:sourceProof.sourceMessageHash,attestedMessageHash:op.attestation!.hash,nonce:op.attestation!.nonce,destinationChain:op.destinationChain,recipient:CIRCLE_RECIPIENT,token:route.token,grossAtomic:"40100" as const,issuerFeeAtomic:op.attestation!.feeExecutedAtomic,netAtomic:op.attestation!.receivedAtomic,caller,controlledDestinationNativeAtomic:"0" as const,sourceApprovalActualFeeAtomic:approvalProof.actualFeeAtomic,sourceBurnActualFeeAtomic:sourceProof.actualFeeAtomic,destinationReceipt,sourceFinality:sourceProof,recipientBalance:{parentHash,parentNumberAtomic:circleUint(parent.number).toString(),before:circleUint(String(before)).toString(),after:circleUint(String(after)).toString(),delta:op.attestation!.receivedAtomic},historicalDeploymentDigest,claimDigest:key,evidenceHash:hashObject(budget.evidence)};
  const fresh={...body,proofHash:hashObject(body)},store=new CircleExternalStore(state.root),prior=await store.readClaim(proofOp);
  const saved=op.externalFulfillment??prior;
  if(saved!==undefined&&saved!==null){if(saved.destinationReceipt.transactionHash!==txHash||saved.destinationReceipt.blockHash!==external.blockHash||saved.destinationReceipt.receiptHash!==external.receiptHash||saved.sourceMessageHash!==sourceProof.sourceMessageHash||saved.attestedMessageHash!==fresh.attestedMessageHash||saved.recipientBalance.before!==fresh.recipientBalance.before||saved.recipientBalance.after!==fresh.recipientBalance.after)circleBlocked("external_frozen_proof_changed");}
  const fulfillment=saved??fresh;validateExternalFulfillment(fulfillment,proofOp);await noPrivate(state,op);await store.claim(proofOp,fulfillment,saved===null||saved===undefined?budget.evidence:await store.evidence(fulfillment));
  if(op.externalFulfillment===undefined){op=advanceCircle(op,{source:sourceProof,effects:op.effects.map(e=>e.role==="approval"?{...e,proof:e.proof?.finalityTag==="finalized"?e.proof:approvalProof}:e.role==="burn"?{...e,proof:e.proof?.finalityTag==="finalized"?e.proof:sourceProof}:e),externalFulfillment:fulfillment,residualAllowanceAtomic:"0"},"external_mint_proof_verified",now());await repo.save(op);}
  await noPrivate(state,op);const rows=await usage.followExternalFulfillment(op);op=advanceCircle(op,{usage:rows,usageFinalized:true,state:"external_fulfilled",terminal:true},"external_fulfillment_closed",now());await repo.save(op);return op;
 });
}
