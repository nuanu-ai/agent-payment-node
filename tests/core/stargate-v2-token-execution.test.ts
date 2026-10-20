import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, keccak256, parseAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { approvalCode } from "../../src/approval-code.js";
import { bindArgv } from "../../src/command-binder.js";
import { LAYERZERO_ENDPOINT_V2_ABI, LAYERZERO_EXECUTOR_ABI, STARGATE_ERC20_ABI, STARGATE_QUOTE_ABI, STARGATE_QUOTE_OFT_OUTPUT, STARGATE_QUOTE_SEND_OUTPUT, STARGATE_SEND_ABI } from "../../src/stargate-v2/abi.js";
import { cleanupStargateV2Token, encodeStargateNativeDrop, executeStargateV2Token, FileStargateTokenJournal, observeStargateV2Token, prepareStargateV2Token, stargateV2TokenCanonicalReceipt,
  LAYERZERO_ENDPOINT_V2, STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_MESSAGING, STARGATE_TOKEN_MECHANISM,
  STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_SOURCE_EXECUTOR, STARGATE_TOKEN_SOURCE_POOL,
  STARGATE_TOKEN_SOURCE_MESSAGING, STARGATE_TOKEN_SOURCE_TOKEN, type StargateTokenExecutionPorts, type StargateTokenJournal, type StargateTokenOperation } from "../../src/stargate-v2/token-execution.js";
import { StateStore } from "../../src/state.js";
import { evmAddressLock } from "../../src/evm-address-ownership.js";
import { TtyStargateTokenApproval } from "../../src/stargate-v2/token-tty.js";
import { temporaryState } from "./helpers.js";
import { lockRefusals } from "./lock-refusal-events.js";
import { KEY, ACCOUNT, OWNER, BLOCK, DEST_BLOCK, GUID, AMOUNT, DROP, FEE, NATIVE_CAP, PACKET_NONCE, packetPayload, unreleasedV1TokenFixture, unreleasedV2TokenFixture, unreleasedV3TokenFixture, seedTokenFixture, MemoryJournal, setup, request } from "./stargate-token-support.js";
test("Type-3 native-drop bytes and pinned contracts are exact", () => { const encoded = encodeStargateNativeDrop(DROP.toString(), OWNER); assert.equal(encoded, `0x000301003102${DROP.toString(16).padStart(32,"0")}${OWNER.slice(2).toLowerCase().padStart(64,"0")}`); assert.equal(STARGATE_TOKEN_SOURCE_EXECUTOR, getAddress("0x2D2ea0697bdbede3F01553D2Ae4B8d0c486B666e")); });
test("prepare freezes staged simulation and a budget-bounded gas ceiling without simulating sendToken at zero allowance", async () => { const s=setup(), op=await prepareStargateV2Token(request(),s.ports,s.journal); assert.equal(op.schemaVersion,"apn.stargate-v2-token-operation.v5"); assert.equal(op.approvalFinalityWindowMs,1_800_000); assert.deepEqual(op.feeApproval,{provenance:"exact_snapshot",quotedMaxFeePerGasWei:"2",quotedMaxPriorityFeePerGasWei:"1",approvedMaxFeePerGasWei:"2",approvedMaxPriorityFeePerGasWei:"1"}); assert.equal(op.finalityPolicyProvenance,"pinned_v2"); assert.equal(op.allowanceRequired,true); assert.deepEqual(op.bridgeSimulation,{mode:"pending_post_approval",prepareStatus:"pending_post_approval",gasCeilingAtomic:op.sendEnvelope.gasLimitAtomic}); assert.equal(op.approvalEnvelope?.nonceAtomic,"7"); assert.equal(op.sendEnvelope.nonceAtomic,"8"); assert.equal(op.sendEnvelope.valueAtomic,FEE.toString()); assert.deepEqual(op.finalityPolicy,{version:"apn.stargate-v2-finality.v1",source:{chainId:10,blockTag:"safe"},destination:{chainId:137,blockTag:"finalized"}}); const approval=decodeFunctionData({abi:STARGATE_ERC20_ABI,data:op.approvalEnvelope!.data}); assert.deepEqual(approval.args,[STARGATE_TOKEN_SOURCE_POOL,AMOUNT]); const send=decodeFunctionData({abi:STARGATE_SEND_ABI,data:op.sendEnvelope.data}); assert.equal(send.functionName,"sendToken"); if (send.functionName !== "sendToken") throw new Error("unexpected"); assert.equal(send.args[0].extraOptions,op.options); assert.deepEqual(s.simulations(),{preparedApprovals:1,preparedBridges:0,bridgeEstimates:0,bridgeCalls:0}); assert.ok(BigInt(op.maximumDebitAtomic)<=BigInt(op.maxNativeDebitAtomic)); assert.equal(s.counts().sends,0); });
test("token schemas no release wrote (v1-v4) are refused as corrupt before any effect", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize();
  const journal=new FileStargateTokenJournal(temporary.root,state);
  for (const [index, fixture] of [unreleasedV1TokenFixture, unreleasedV2TokenFixture, unreleasedV3TokenFixture].entries()) {
    const s=setup({allowance:AMOUNT}), prepared=await prepareStargateV2Token(request({idempotencyKey:`unreleased-token-schema-${index}`}),s.ports,s.journal);
    await seedTokenFixture(temporary.root,fixture(prepared));
    await assert.rejects(journal.load(prepared.operationId),(e:any)=>e.code==="APN_STATE_CORRUPT"&&e.details.reason==="schema");
    await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,journal),(e:any)=>e.code==="APN_STATE_CORRUPT");
    assert.deepEqual(s.counts(),{sends:0,signs:0,approvals:0});
  }
});
test("v5 token missing policy and policy drift are corrupt before effects", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize(); const journal=new FileStargateTokenJournal(temporary.root,state);
  const missingSetup=setup(),missing=await prepareStargateV2Token(request({idempotencyKey:"v2-token-missing-policy"}),missingSetup.ports,missingSetup.journal);
  const {integrityHash:_i,finalityPolicy:_p,finalityPolicyProvenance:_fp,...missingBody}=missing; await seedTokenFixture(temporary.root,{...missingBody,integrityHash:hashObject(missingBody)} as StargateTokenOperation);
  await assert.rejects(journal.load(missing.operationId),(e:any)=>e.code==="APN_STATE_CORRUPT");
  const driftSetup=setup(),driftOp=await prepareStargateV2Token(request({idempotencyKey:"v2-token-policy-drift"}),driftSetup.ports,driftSetup.journal);
  const {integrityHash:_di,...driftBody}={...driftOp,finalityPolicy:{...driftOp.finalityPolicy,destination:{chainId:137 as const,blockTag:"safe" as const}}}; await seedTokenFixture(temporary.root,{...driftBody,integrityHash:hashObject(driftBody)} as StargateTokenOperation);
  await assert.rejects(journal.load(driftOp.operationId),(e:any)=>e.code==="APN_STATE_CORRUPT");
});
test("zero native drop emits no options and remains cap checked", async () => { const s=setup({allowance:AMOUNT}), op=await prepareStargateV2Token(request({idempotencyKey:"token-only-route",nativeDropAtomic:"0"}),s.ports,s.journal); assert.equal(op.options,"0x"); assert.equal(op.nativeDropAtomic,"0"); });
test("existing exact allowance keeps exact prepare simulation while residual or cap overflow fail closed", async () => { const exact=setup({allowance:AMOUNT}), op=await prepareStargateV2Token(request(),exact.ports,exact.journal); assert.equal(op.allowanceRequired,false); assert.equal(op.approvalEnvelope,undefined); assert.deepEqual(op.bridgeSimulation,{mode:"exact_at_prepare",prepareStatus:"succeeded",gasCeilingAtomic:"100000"}); assert.deepEqual(exact.simulations(),{preparedApprovals:0,preparedBridges:1,bridgeEstimates:0,bridgeCalls:0}); await assert.rejects(prepareStargateV2Token(request({idempotencyKey:"residual-allowance"}),setup({allowance:1n}).ports,new MemoryJournal()), (e:any)=>e.details?.reason==="residual_allowance_cleanup_required"); await assert.rejects(prepareStargateV2Token(request({idempotencyKey:"native-cap-over"}),setup({nativeCap:DROP-1n}).ports,new MemoryJournal()), (e:any)=>e.details?.reason==="native_drop_cap_exceeded"); });
test("approval and bridge effects are separately marked, exact, observed, and canonical", async () => { const s=setup(), prepared=await prepareStargateV2Token(request(),s.ports,s.journal), observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed"); assert.equal(observed.residualAllowanceAtomic,"0"); assert.equal(observed.usageState,"finalized"); assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1}); assert.deepEqual(observed.transitions.map(x=>x.phase),["prepared","approved","allowance_submission_started","allowance_submitted","allowance_observed","post_approval_quote_bound","submission_started","submitted","observed"]); const receipt=stargateV2TokenCanonicalReceipt(observed); assert.equal(receipt.schemaVersion,"apn.stargate-v2-token-receipt.v2"); assert.match(receipt.quoteLifecycle!.postApprovalQuoteHash!,/^[a-f0-9]{64}$/u); assert.match(receipt.evidenceHash,/^[a-f0-9]{64}$/u); });

test("owner fee ceilings freeze quoted and approved pairs and admit movement within both ceilings", async () => {
  const s=setup({preparedPriority:0n,freshPriorityAfterApproval:1n});
  const prepared=await prepareStargateV2Token(request({idempotencyKey:"fee-ceiling-inside",maxFeePerGasWei:"4",maxPriorityFeePerGasWei:"2"}),s.ports,s.journal);
  assert.deepEqual(prepared.feeApproval,{provenance:"owner_ceiling",quotedMaxFeePerGasWei:"2",quotedMaxPriorityFeePerGasWei:"0",approvedMaxFeePerGasWei:"4",approvedMaxPriorityFeePerGasWei:"2"});
  assert.equal(prepared.approvalEnvelope?.maxFeePerGasAtomic,"4"); assert.equal(prepared.sendEnvelope.maxPriorityFeePerGasAtomic,"2");
  const observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed");
  assert.deepEqual(stargateV2TokenCanonicalReceipt(observed).feeApproval,prepared.feeApproval);
});

test("fee ceiling pair validation rejects missing, malformed, inverted, and below-quote values", async () => {
  for (const changes of [
    {maxFeePerGasWei:"4"}, {maxPriorityFeePerGasWei:"2"}, {maxFeePerGasWei:"0",maxPriorityFeePerGasWei:"1"},
    {maxFeePerGasWei:"04",maxPriorityFeePerGasWei:"1"}, {maxFeePerGasWei:"2",maxPriorityFeePerGasWei:"3"},
    {maxFeePerGasWei:"1",maxPriorityFeePerGasWei:"1"}, {maxFeePerGasWei:"2",maxPriorityFeePerGasWei:"0"},
  ]) { const s=setup(); await assert.rejects(prepareStargateV2Token(request({idempotencyKey:`bad-fees-${JSON.stringify(changes)}`.replaceAll(/[^A-Za-z0-9._:-]/gu,"x").slice(0,128),...changes}),s.ports,s.journal),(e:any)=>e.code==="APN_INVALID_INPUT"); }
});

test("approved max fee drives staged debit division with integer rounding", async () => {
  const cap=15_000_002n,s=setup(),op=await prepareStargateV2Token(request({idempotencyKey:"fee-ceiling-rounding",maxNativeDebitAtomic:cap.toString(),maxFeePerGasWei:"3",maxPriorityFeePerGasWei:"1"}),s.ports,s.journal);
  const approval=100_000n*3n,expected=(cap-approval-FEE)/3n; assert.equal(op.sendEnvelope.gasLimitAtomic,expected.toString());
  assert.equal(op.maximumDebitAtomic,(approval+FEE+expected*3n).toString()); assert.ok(BigInt(op.maximumDebitAtomic)<=cap);
});

test("CLI binds fee ceilings only when supplied and exposes both API fields", () => {
  const base=["stargate","token","prepare","--profile","owner","--amount-atomic","100000","--min-output-atomic","99000","--max-native-debit-atomic","10000000","--idempotency-key","cli-fees-001"];
  assert.equal((bindArgv(base).request as any).maxFeePerGasWei,undefined);
  const request=(bindArgv([...base,"--max-fee-per-gas-wei","4","--max-priority-fee-per-gas-wei","2"]).request as any);
  assert.equal(request.maxFeePerGasWei,"4"); assert.equal(request.maxPriorityFeePerGasWei,"2");
});

test("TTY approval displays quoted and approved fee pairs", async () => {
  const s=setup(),op=await prepareStargateV2Token(request({idempotencyKey:"tty-fee-ceilings",maxFeePerGasWei:"4",maxPriorityFeePerGasWei:"2"}),s.ports,s.journal);
  let printed=""; const phrase=approvalCode("bridge",op.integrityHash);
  const tty=new TtyStargateTokenApproval({isTerminal:()=>true,openTerminal:async()=>({fd:1,write:async(value:string)=>{printed+=value;},read:async function*(){yield Buffer.from(`${phrase}\n`);},close:async()=>{}})});
  await tty.approve(op); assert.match(printed,/quoted max\/priority: 2 \/ 1/u); assert.match(printed,/approved max\/priority: 4 \/ 2/u); assert.match(printed,/owner_ceiling/u);
  assert.match(printed,/30 minutes/u); assert.match(printed,/preparation quote is never used/u);
  assert.match(printed,/Initial quoted Polygon USDC output: 100000/u);
  assert.match(printed,/Owner-approved minimum Polygon USDC output: 99000; maximum quote loss: 1000 atomic USDC/u);
  assert.match(printed,/Initial quoted LayerZero fee: 1000 wei ETH/u);
  assert.match(printed,/Owner-approved source native debit cap: 10000000000000000 wei ETH/u);
  assert.match(printed,/output and LayerZero fee may change/u);
  assert.doesNotMatch(printed,/minimum Polygon USDC: 100000/u);
});

test("sufficient allowance path signs the owner approved ceiling pair without an approval transaction", async () => {
  const s=setup({allowance:AMOUNT}),prepared=await prepareStargateV2Token(request({idempotencyKey:"fee-ceiling-sufficient-allowance",maxFeePerGasWei:"4",maxPriorityFeePerGasWei:"2"}),s.ports,s.journal);
  assert.equal(prepared.approvalEnvelope,undefined); assert.equal(prepared.sendEnvelope.maxFeePerGasAtomic,"4"); assert.equal(prepared.sendEnvelope.maxPriorityFeePerGasAtomic,"2");
  const observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed"); assert.deepEqual(s.counts(),{sends:1,signs:1,approvals:1});
});

test("v4 integrity validation rejects inconsistent approved fee provenance before effects", async (t) => {
  const temporary=await temporaryState();t.after(temporary.cleanup);const state=new StateStore(temporary.root);await state.initialize();const s=setup();const op=await prepareStargateV2Token(request({idempotencyKey:"fee-binding-corrupt",maxFeePerGasWei:"4",maxPriorityFeePerGasWei:"2"}),s.ports,s.journal);
  const {integrityHash:_integrity,...body}=op,bad={...body,feeApproval:{...op.feeApproval!,approvedMaxFeePerGasWei:"3"}};await seedTokenFixture(temporary.root,{...bad,integrityHash:hashObject(bad)} as StargateTokenOperation);
  await assert.rejects(new FileStargateTokenJournal(temporary.root,state).load(op.operationId),(e:any)=>e.code==="APN_STATE_CORRUPT"&&e.details.reason==="fee_approval_binding");assert.deepEqual(s.counts(),{sends:0,signs:0,approvals:0});
});

test("v4 FileJournal saves and loads an omitted fee ceiling snapshot with a zero quoted priority", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize();
  const journal=new FileStargateTokenJournal(temporary.root,state),s=setup({preparedPriority:0n});
  const prepared=await prepareStargateV2Token(request({idempotencyKey:"file-journal-zero-tip-snapshot"}),s.ports,journal);
  const loaded=await journal.load(prepared.operationId);
  assert.deepEqual(loaded?.feeApproval,{provenance:"exact_snapshot",quotedMaxFeePerGasWei:"2",quotedMaxPriorityFeePerGasWei:"0",approvedMaxFeePerGasWei:"2",approvedMaxPriorityFeePerGasWei:"0"});
  assert.equal(loaded?.sendEnvelope.maxFeePerGasAtomic,"2"); assert.equal(loaded?.sendEnvelope.maxPriorityFeePerGasAtomic,"0");
});

test("v4 FileJournal saves and loads an owner ceiling above a zero quoted priority", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize();
  const journal=new FileStargateTokenJournal(temporary.root,state),s=setup({preparedPriority:0n});
  const prepared=await prepareStargateV2Token(request({idempotencyKey:"file-journal-zero-quote-owner-ceiling",maxFeePerGasWei:"4",maxPriorityFeePerGasWei:"2"}),s.ports,journal);
  const loaded=await journal.load(prepared.operationId);
  assert.deepEqual(loaded?.feeApproval,{provenance:"owner_ceiling",quotedMaxFeePerGasWei:"2",quotedMaxPriorityFeePerGasWei:"0",approvedMaxFeePerGasWei:"4",approvedMaxPriorityFeePerGasWei:"2"});
  assert.equal(loaded?.approvalEnvelope?.maxPriorityFeePerGasAtomic,"2"); assert.equal(loaded?.sendEnvelope.maxPriorityFeePerGasAtomic,"2");
});

test("v4 FileJournal rejects malformed zero and inverted fee bindings", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize();
  const journal=new FileStargateTokenJournal(temporary.root,state),s=setup({preparedPriority:0n});
  const op=await prepareStargateV2Token(request({idempotencyKey:"file-journal-malformed-fees",maxFeePerGasWei:"4",maxPriorityFeePerGasWei:"2"}),s.ports,s.journal);
  for (const feeApproval of [
    {...op.feeApproval!,approvedMaxFeePerGasWei:"0"},
    {...op.feeApproval!,approvedMaxPriorityFeePerGasWei:"5"},
    {...op.feeApproval!,quotedMaxPriorityFeePerGasWei:"3"},
    {...op.feeApproval!,approvedMaxPriorityFeePerGasWei:"00"},
  ]) {
    const {integrityHash:_integrity,...body}={...op,feeApproval}; const corrupt={...body,integrityHash:hashObject(body)} as StargateTokenOperation;
    await assert.rejects(journal.save(corrupt),(e:any)=>e.code==="APN_STATE_CORRUPT"&&e.details.reason==="fee_approval_binding");
  }
});

test("post-approval exact estimate and eth_call pass before one bridge signature", async () => { const s=setup(), prepared=await prepareStargateV2Token(request({idempotencyKey:"staged-pass"}),s.ports,s.journal); const observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed"); assert.deepEqual(s.simulations(),{preparedApprovals:1,preparedBridges:1,bridgeEstimates:1,bridgeCalls:1}); assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1}); const receipt=stargateV2TokenCanonicalReceipt(observed); assert.equal(receipt.bridgeSimulation.mode,"pending_post_approval"); assert.equal(receipt.bridgeSimulation.gasCeilingAtomic,prepared.sendEnvelope.gasLimitAtomic); });

test("safe approval lag beyond the preparation TTL binds one fresh quote and sends one bridge", async () => {
  const s=setup({approvalPendingPolls:1}),prepared=await prepareStargateV2Token(request({idempotencyKey:"safe-lag-requote",ttlMs:60_000}),s.ports,s.journal);
  assert.equal((await executeStargateV2Token(prepared.operationId,s.ports,s.journal)).phase,"allowance_unknown_finality");
  s.advance(90_000); const observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal);
  assert.equal(observed.phase,"observed"); assert.ok(Date.parse(observed.approvalFinalityDeadline!)>Date.parse(observed.expiresAt));
  assert.match(observed.postApprovalQuote!.quote.quoteHash,/^[a-f0-9]{64}$/u); assert.match(observed.postApprovalQuote!.snapshotHash,/^[a-f0-9]{64}$/u);
  assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1});
  assert.equal(observed.transitions.filter(x=>x.phase==="post_approval_quote_bound").length,1);
  assert.equal(observed.transitions.filter(x=>x.phase==="submission_started").length,1);
});

test("owner floor explicitly consents to a post-approval quote down from 100000 to 99000", async () => {
  const s=setup({postApprovalMinimumOutput:99_000n}),prepared=await prepareStargateV2Token(request({idempotencyKey:"requote-owner-floor-accepted"}),s.ports,s.journal);
  const observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed");
  assert.equal(observed.postApprovalQuote?.ownerApprovedMinimumOutputAtomic,"99000");
  assert.equal(observed.postApprovalQuote?.ownerApprovedMaximumQuoteLossAtomic,"1000");
  const receipt=stargateV2TokenCanonicalReceipt(observed); assert.equal(receipt.minimumOutputAtomic,"99000");
  assert.equal(receipt.quoteLifecycle!.initialQuotedOutputAtomic,"100000");
  assert.equal(receipt.quoteLifecycle!.ownerApprovedMinimumOutputAtomic,"99000");
  assert.equal(receipt.quoteLifecycle!.ownerApprovedMaximumQuoteLossAtomic,"1000");
  assert.equal(receipt.quoteLifecycle!.postApprovalQuotedOutputAtomic,"99000");
  assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1});
});

test("approval finality beyond the bounded window enters forced cleanup without bridge signing", async () => {
  const s=setup({approvalPendingPolls:5}),prepared=await prepareStargateV2Token(request({idempotencyKey:"safe-lag-window-expired"}),s.ports,s.journal);
  assert.equal((await executeStargateV2Token(prepared.operationId,s.ports,s.journal)).phase,"allowance_unknown_finality");
  s.advance(1_800_001); const required=await executeStargateV2Token(prepared.operationId,s.ports,s.journal);
  assert.equal(required.phase,"cleanup_required"); assert.equal(required.cleanupReason,"approval_finality_deadline_passed");
  assert.deepEqual(s.counts(),{sends:1,signs:1,approvals:1}); assert.equal(required.postApprovalQuote,undefined);
  const cleaned=await cleanupStargateV2Token(prepared.operationId,s.ports,s.journal);assert.equal(cleaned.phase,"cleaned");assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:2});
});

test("foreground approval that returns after preparation expiry cannot create an approval marker", async () => {
  const s=setup({approveAdvancesMs:16_000}),prepared=await prepareStargateV2Token(request({idempotencyKey:"approval-marker-expired",ttlMs:15_000}),s.ports,s.journal);
  await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),(e:any)=>e.details?.reason==="approval_completed_after_prepare_expiry");
  assert.equal(s.journal.value?.phase,"prepared"); assert.deepEqual(s.counts(),{sends:0,signs:0,approvals:1});
});

for (const [name,options,reason] of [
  ["minimum-output-one-below-owner-floor",{postApprovalMinimumOutput:98_999n},"post_approval_quote_post_approval_minimum_output"],
  ["executor-cap",{postApprovalNativeCap:DROP-1n},"post_approval_quote_post_approval_native_drop_cap"],
  ["native-debit",{postApprovalFee:10_000_000_000_000_000n},"post_approval_quote_post_approval_max_native_debit"],
] as const) test(`fresh post-approval ${name} degradation enters cleanup`,async()=>{const s=setup(options),prepared=await prepareStargateV2Token(request({idempotencyKey:`requote-${name}`}),s.ports,s.journal);const required=await executeStargateV2Token(prepared.operationId,s.ports,s.journal);assert.equal(required.phase,"cleanup_required");assert.equal(required.cleanupReason,reason);assert.deepEqual(s.counts(),{sends:1,signs:1,approvals:1});});

test("post-approval policy drift enters cleanup before quote persistence",async()=>{const s=setup({confirmPolicyErrorAfterApproval:true}),prepared=await prepareStargateV2Token(request({idempotencyKey:"requote-policy-drift"}),s.ports,s.journal);const required=await executeStargateV2Token(prepared.operationId,s.ports,s.journal);assert.equal(required.phase,"cleanup_required");assert.equal(required.cleanupReason,"post_approval_quote_unavailable");assert.equal(required.postApprovalQuote,undefined);assert.deepEqual(s.counts(),{sends:1,signs:1,approvals:1});});

test("a persisted post-approval quote that expires before signing requires cleanup",async()=>{const s=setup({saveErrorPhaseOnce:"post_approval_quote_bound",saveErrorAfterSave:true}),prepared=await prepareStargateV2Token(request({idempotencyKey:"requote-expired-before-sign"}),s.ports,s.journal);await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),/journal crash/u);assert.equal(s.journal.value?.phase,"post_approval_quote_bound");s.advance(60_001);const required=await executeStargateV2Token(prepared.operationId,s.ports,s.journal);assert.equal(required.phase,"cleanup_required");assert.equal(required.cleanupReason,"post_approval_quote_expired");assert.deepEqual(s.counts(),{sends:1,signs:1,approvals:1});});

test("crash before quote persistence re-quotes idempotently and crash at bridge marker never duplicates the bridge send",async()=>{
  const quoteCrash=setup({saveErrorPhaseOnce:"post_approval_quote_bound"}),first=await prepareStargateV2Token(request({idempotencyKey:"requote-persist-crash"}),quoteCrash.ports,quoteCrash.journal);await assert.rejects(executeStargateV2Token(first.operationId,quoteCrash.ports,quoteCrash.journal),/journal crash/u);assert.equal(quoteCrash.journal.value?.phase,"allowance_observed");assert.equal((await executeStargateV2Token(first.operationId,quoteCrash.ports,quoteCrash.journal)).phase,"observed");assert.deepEqual(quoteCrash.counts(),{sends:2,signs:2,approvals:1});
  const markerCrash=setup({saveErrorPhaseOnce:"submission_started"}),second=await prepareStargateV2Token(request({idempotencyKey:"bridge-marker-crash"}),markerCrash.ports,markerCrash.journal);await assert.rejects(executeStargateV2Token(second.operationId,markerCrash.ports,markerCrash.journal),/journal crash/u);assert.equal(markerCrash.journal.value?.phase,"post_approval_quote_bound");assert.equal((await executeStargateV2Token(second.operationId,markerCrash.ports,markerCrash.journal)).phase,"observed");assert.deepEqual(markerCrash.counts(),{sends:2,signs:3,approvals:1});assert.equal(markerCrash.journal.history.filter(x=>x.phase==="submission_started").length,1);
});

test("stored post-approval quote tampering is rejected by nested integrity and owner-floor binding",async(t)=>{const temporary=await temporaryState();t.after(temporary.cleanup);const state=new StateStore(temporary.root);await state.initialize();const s=setup({saveErrorPhaseOnce:"post_approval_quote_bound",saveErrorAfterSave:true}),prepared=await prepareStargateV2Token(request({idempotencyKey:"requote-integrity"}),s.ports,s.journal);await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),/journal crash/u);const saved=s.journal.value!;const mutated={...saved,postApprovalQuote:{...saved.postApprovalQuote!,expiresAt:new Date(Date.parse(saved.postApprovalQuote!.expiresAt)+1).toISOString()}};const {integrityHash:_old,...body}=mutated;await seedTokenFixture(temporary.root,{...body,integrityHash:hashObject(body)} as StargateTokenOperation);await assert.rejects(new FileStargateTokenJournal(temporary.root,state).load(saved.operationId),(e:any)=>e.code==="APN_STATE_CORRUPT"&&e.details.reason==="post_approval_quote_integrity");
  const {snapshotHash:_snapshot,...snapshotBody}=saved.postApprovalQuote!;const reboundBody={...snapshotBody,ownerApprovedMinimumOutputAtomic:"98000"};const reboundSnapshot={...reboundBody,snapshotHash:hashObject(reboundBody)};const rebound={...saved,postApprovalQuote:reboundSnapshot};const {integrityHash:_outer,...reboundOperationBody}=rebound;await seedTokenFixture(temporary.root,{...reboundOperationBody,integrityHash:hashObject(reboundOperationBody)} as StargateTokenOperation);await assert.rejects(new FileStargateTokenJournal(temporary.root,state).load(saved.operationId),(e:any)=>e.code==="APN_STATE_CORRUPT"&&e.details.reason==="post_approval_quote_binding");});

for (const [name, options, reason] of [
  ["revert", {bridgeSimulationRevert:true}, "post_approval_quote_post_approval_send_simulation"],
  ["over-ceiling", {bridgeEstimateGas:5_000_001n}, "post_approval_quote_post_approval_gas_limit"],
  ["fee-spike", {feeSpikeAfterApproval:true}, "fee_spike"],
] as const) test(`post-approval ${name} enters cleanup with zero bridge effects`, async () => { const s=setup(options), prepared=await prepareStargateV2Token(request({idempotencyKey:`staged-${name}`}),s.ports,s.journal); const required=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(required.phase,"cleanup_required"); assert.equal(required.cleanupReason,reason); assert.equal(s.counts().sends,1); assert.equal(s.counts().signs,1); assert.equal(required.transactionHash,undefined); const cleaned=await cleanupStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(cleaned.phase,"cleaned"); });

test("a fresh market tip above the signed priority fee no longer forces a paid revoke: the signed envelope is still includable", async () => {
  const s=setup({freshPriorityAfterApproval:3n}),prepared=await prepareStargateV2Token(request({idempotencyKey:"ceiling-priority-fee",maxFeePerGasWei:"4",maxPriorityFeePerGasWei:"2"}),s.ports,s.journal);
  const observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed"); assert.equal(observed.cleanupReason,undefined);
  assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1});
});

test("BRDG-29: a base fee that rose after the approval but still fits under the signed max fee sends the bridge instead of a paid revoke", async () => {
  // Old rule: 2 × 1 + 1 = 3 > 2 refused and forced approve-zero; the frozen envelope pays base 1 + tip 1 ≤ 2.
  const s=setup({baseFeeAfterApproval:1n}),prepared=await prepareStargateV2Token(request({idempotencyKey:"brdg29-rise-within-cap"}),s.ports,s.journal);
  const observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed"); assert.equal(observed.cleanupReason,undefined);
  assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1});
});

test("BRDG-29: a fresh post-approval fee estimate above the approved cap is evidence only and the bridge is signed with the approved fields", async () => {
  const s=setup({postApprovalPreparedMaxFee:5n}),prepared=await prepareStargateV2Token(request({idempotencyKey:"brdg29-post-approval-estimate"}),s.ports,s.journal);
  const observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed");
  assert.equal(observed.postApprovalQuote?.sourceSnapshot.quotedMaxFeePerGasWei,"5"); assert.equal(observed.postApprovalQuote?.sendEnvelope.maxFeePerGasAtomic,"2");
  assert.equal(stargateV2TokenCanonicalReceipt(observed).feeApproval.approvedMaxFeePerGasWei,"2");
});

test("BRDG-29: an envelope that cannot be included is refused before the approval is signed, so no approval or revoke is paid", async () => {
  const s=setup({baseFeeBeforeApproval:2n}),prepared=await prepareStargateV2Token(request({idempotencyKey:"brdg29-before-approval"}),s.ports,s.journal);
  await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),(error:any)=>error.code==="APN_REPREPARE_REQUIRED"&&error.details.reason==="fee_spike");
  assert.deepEqual(s.counts(),{sends:0,signs:0,approvals:1}); assert.equal(s.journal.value?.phase,"approved"); assert.equal(s.journal.value?.approvalTransactionHash,undefined);
});

for (const [name,options,fees] of [
  ["max-fee",{feeSpikeAfterApproval:true},{maxFeePerGasWei:"2",maxPriorityFeePerGasWei:"2"}],
] as const) test(`fresh ${name} above its owner ceiling requires cleanup before bridge signing`,async()=>{const s=setup(options),prepared=await prepareStargateV2Token(request({idempotencyKey:`ceiling-${name}`,...fees}),s.ports,s.journal);const required=await executeStargateV2Token(prepared.operationId,s.ports,s.journal);assert.equal(required.phase,"cleanup_required");assert.equal(required.cleanupReason,"fee_spike");assert.deepEqual(s.counts(),{sends:1,signs:1,approvals:1});});

test("staged total debit includes approval gas, message value, and protocol-bounded bridge ceiling", async () => { const cap=10_500_000n, s=setup(), op=await prepareStargateV2Token(request({idempotencyKey:"staged-debit-math",maxNativeDebitAtomic:cap.toString()}),s.ports,s.journal); const approval=BigInt(op.approvalEnvelope!.gasLimitAtomic)*BigInt(op.approvalEnvelope!.maxFeePerGasAtomic), bridge=BigInt(op.sendEnvelope.gasLimitAtomic)*BigInt(op.sendEnvelope.maxFeePerGasAtomic); assert.equal(BigInt(op.maximumDebitAtomic),approval+FEE+bridge); assert.ok(BigInt(op.maximumDebitAtomic)<=cap); const budget=(cap-approval-FEE)/2n; assert.equal(op.bridgeSimulation?.gasCeilingAtomic,(budget>5_000_000n?5_000_000n:budget).toString()); });
test("ambiguous approval is durable and concurrent/repeated execute never resends", async () => { const s=setup({sendErrorAt:1}), prepared=await prepareStargateV2Token(request(),s.ports,s.journal); const [a,b]=await Promise.all([executeStargateV2Token(prepared.operationId,s.ports,s.journal),executeStargateV2Token(prepared.operationId,s.ports,s.journal)]); assert.equal(a.phase,"allowance_unknown_finality"); assert.equal(b.phase,"observed"); assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1}); assert.equal(s.journal.history.filter(x=>x.phase==="allowance_submission_started").length,1); });
test("ambiguous staged bridge is observed without a second signature or resend", async () => { const s=setup({sendErrorAt:2}), prepared=await prepareStargateV2Token(request({idempotencyKey:"staged-bridge-ambiguous"}),s.ports,s.journal); const unknown=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(unknown.phase,"unknown_finality"); const before=s.counts(), observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed"); assert.deepEqual(s.counts(),before); assert.equal(s.journal.history.filter(x=>x.phase==="submission_started").length,1); });
test("observe recovers an ambiguous approval without signing or broadcasting the bridge", async () => { const s=setup({sendErrorAt:1}), prepared=await prepareStargateV2Token(request({idempotencyKey:"observe-only-approval"}),s.ports,s.journal); const unknown=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(unknown.phase,"allowance_unknown_finality"); const observed=await observeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"allowance_observed"); assert.deepEqual(s.counts(),{sends:1,signs:1,approvals:1}); });
test("legacy/type-confused envelope is rejected before any send and requires explicit cleanup", async () => { const s=setup({allowance:AMOUNT,legacy:true}), prepared=await prepareStargateV2Token(request(),s.ports,s.journal); await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),(e:any)=>e.details?.reason==="signed_transaction_envelope"); assert.equal(s.counts().sends,0); assert.equal(s.journal.value?.phase,"cleanup_required"); });
test("destination GUID mismatch cannot terminalize", async () => { const s=setup({allowance:AMOUNT,destinationMutation:"guid"}), prepared=await prepareStargateV2Token(request({idempotencyKey:"destination-guid"}),s.ports,s.journal); await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),(e:any)=>e.code==="APN_RPC_PROTOCOL"); assert.notEqual(s.journal.value?.phase,"observed"); });
for (const mutation of ["sender","receiver","guid"] as const) test(`source PacketSent ${mutation} mismatch cannot terminalize`, async () => { const s=setup({allowance:AMOUNT,sourcePacketMutation:mutation}), prepared=await prepareStargateV2Token(request({idempotencyKey:`source-packet-${mutation}`}),s.ports,s.journal); await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),(e:any)=>e.code==="APN_RPC_PROTOCOL"); assert.notEqual(s.journal.value?.phase,"observed"); });
for (const mutation of ["native","token"] as const) test(`destination ${mutation} balance is corroborative after exact event proof`, async () => { const s=setup({allowance:AMOUNT,destinationMutation:mutation}), prepared=await prepareStargateV2Token(request({idempotencyKey:`destination-${mutation}-corroborative`}),s.ports,s.journal); assert.equal((await executeStargateV2Token(prepared.operationId,s.ports,s.journal)).phase,"observed"); });

test("confirmed bridge revert enters explicit cleanup and approve-zero reaches terminal zero allowance", async () => {
  const s = setup({ allowance: AMOUNT, bridgeRevert: true });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "bridge-revert-cleanup" }), s.ports, s.journal);
  const required = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(required.phase, "cleanup_required"); assert.equal(required.residualAllowanceAtomic, AMOUNT.toString());
  const cleaned = await cleanupStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(cleaned.phase, "cleaned"); assert.equal(cleaned.residualAllowanceAtomic, "0");
  assert.deepEqual(s.counts(), { sends: 2, signs: 2, approvals: 2 });
  const before = s.counts(); assert.equal((await observeStargateV2Token(prepared.operationId, s.ports, s.journal)).phase, "cleaned"); assert.deepEqual(s.counts(), before);
});

test("bridge preflight failure after approval requires explicit cleanup without reserving, signing, or sending", async () => {
  const s = setup({ allowance: AMOUNT, preflightNonceDrift: true });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "preflight-cleanup" }), s.ports, s.journal);
  const required = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(required.phase, "cleanup_required"); assert.equal(required.cleanupReason, "nonce_changed");
  assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
});

test("usage reservation cap race after approval durably requires cleanup", async () => {
  const s = setup({ allowance: AMOUNT, reserveError: true });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "usage-cap-race-cleanup" }), s.ports, s.journal);
  const required = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(required.phase, "cleanup_required"); assert.equal(required.cleanupReason, "usage_reservation_failed");
  assert.equal(required.usageState, "failed_before_effect"); assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
  const cleaned = await cleanupStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(cleaned.phase, "cleaned"); assert.equal(cleaned.residualAllowanceAtomic, "0");
});

test("persisted reservation intent that loses a retry cap race still enters cleanup", async () => {
  const s = setup({ allowance: AMOUNT, reserveError: true });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "usage-intent-crash-race" }), s.ports, s.journal);
  await s.journal.save({ ...prepared, phase: "approved", transitions: [...prepared.transitions, { phase: "approved", at: new Date(2_000_000_000_000).toISOString(), reason: "foreground_owner_confirmation" }], usageTarget: "reserved" } as StargateTokenOperation);
  const required = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(required.phase, "cleanup_required"); assert.equal(required.usageState, "failed_before_effect"); assert.equal(s.counts().signs, 0);
});

test("submitted usage transition error resumes without signing or sending again", async () => {
  const s = setup({ allowance: AMOUNT, followErrorOnce: "submitted" });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "usage-submitted-reconcile" }), s.ports, s.journal);
  await assert.rejects(executeStargateV2Token(prepared.operationId, s.ports, s.journal), /usage transition crash/u);
  assert.equal(s.journal.value?.phase, "submitted"); assert.equal(s.journal.value?.usageTarget, "submitted");
  const before = s.counts(), observed = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(observed.phase, "observed"); assert.equal(observed.usageState, "finalized"); assert.deepEqual(s.counts(), before);
});

test("finalized usage transition error resumes from observed proof without resend", async () => {
  const s = setup({ allowance: AMOUNT, followErrorOnce: "finalized" });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "usage-finalized-reconcile" }), s.ports, s.journal);
  await assert.rejects(executeStargateV2Token(prepared.operationId, s.ports, s.journal), /usage transition crash/u);
  assert.equal(s.journal.value?.phase, "observed"); assert.equal(s.journal.value?.usageTarget, "finalized");
  const before = s.counts(), observed = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(observed.usageState, "finalized"); assert.equal(observed.usageTarget, undefined); assert.deepEqual(s.counts(), before);
});

test("signing failure usage release error is reconciled by cleanup without bridge resend", async () => {
  const s = setup({ allowance: AMOUNT, signErrorOnce: true, followErrorOnce: "failed_before_effect" });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "usage-signing-failure-reconcile" }), s.ports, s.journal);
  await assert.rejects(executeStargateV2Token(prepared.operationId, s.ports, s.journal));
  assert.equal(s.journal.value?.phase, "cleanup_required"); assert.equal(s.journal.value?.usageTarget, "failed_before_effect");
  const sends = s.counts().sends, cleaned = await cleanupStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(cleaned.phase, "cleaned"); assert.equal(cleaned.usageState, "failed_before_effect"); assert.equal(s.counts().sends, sends + 1);
});

test("successful delivery with residual allowance cleans up before canonical completion", async () => {
  const s = setup({ allowance: AMOUNT, residualAfterBridge: true });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "delivered-residual-cleanup" }), s.ports, s.journal);
  const required = await executeStargateV2Token(prepared.operationId, s.ports, s.journal); assert.equal(required.phase, "cleanup_required");
  const observed = await cleanupStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(observed.phase, "observed"); assert.equal(observed.residualAllowanceAtomic, "0"); assert.match(stargateV2TokenCanonicalReceipt(observed).evidenceHash, /^[a-f0-9]{64}$/u);
});

test("ambiguous cleanup marker is observe-only and never resends", async () => {
  const s = setup({ allowance: AMOUNT, bridgeRevert: true, sendErrorAt: 2 });
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "ambiguous-cleanup" }), s.ports, s.journal);
  assert.equal((await executeStargateV2Token(prepared.operationId, s.ports, s.journal)).phase, "cleanup_required");
  assert.equal((await cleanupStargateV2Token(prepared.operationId, s.ports, s.journal)).phase, "cleanup_unknown_finality");
  const before = s.counts(), cleaned = await observeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(cleaned.phase, "cleaned"); assert.deepEqual(s.counts(), before);
});

test("distinct operations for one owner serialize through preflight and only one can sign the shared nonce", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const journal = new FileStargateTokenJournal(temporary.root, state), s = setup({ allowance: AMOUNT, advanceNonceOnSend: true });
  const first = await prepareStargateV2Token(request({ idempotencyKey: "same-owner-race-one" }), s.ports, journal);
  // Phase 4b: the owner's claim refuses a second unresolved operation at prepare, before any read.
  await assert.rejects(prepareStargateV2Token(request({ idempotencyKey: "same-owner-race-two" }), s.ports, journal),
    { code: "APN_OPERATION_BLOCKED", details: { blockingOperationId: first.operationId, blockingState: "prepared", blockingNetwork: "evm:10",
      blockingAccount: OWNER.toLowerCase() } });
  // Two journals a released version prepared before the upgrade still serialize at execution through the owner lock.
  class ReleasedVersionJournal extends FileStargateTokenJournal { override async admit<T>(_operation: unknown, work: () => Promise<T>) { return await work(); } }
  const second = await prepareStargateV2Token(request({ idempotencyKey: "same-owner-race-two" }), s.ports, new ReleasedVersionJournal(temporary.root, state));
  const [a, b] = await Promise.all([executeStargateV2Token(first.operationId, s.ports, journal), executeStargateV2Token(second.operationId, s.ports, journal)]);
  assert.equal([a.phase, b.phase].includes("observed"), true); assert.equal(s.counts().signs, 1); assert.equal(s.counts().sends, 1);
  assert.equal([a.phase, b.phase].some(phase => phase === "cleaned" || phase === "cleanup_required"), true);
});

test("BRDG-35: the owner lock is the kernel evmAddressLock shared with every EVM family; different owners still proceed concurrently", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const journal = new FileStargateTokenJournal(temporary.root, state), locks = lockRefusals(t);
  // Events, not sleeps (a fixed pause failed this test once under a loaded full suite). Another owner's lock is taken and
  // released while this owner's is still held: a shared lock would never let it in.
  const other = getAddress("0x2222222222222222222222222222222222222222");
  let releaseFirst!: () => void, firstIn!: () => void; const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
  const firstInside = new Promise<void>(resolve => { firstIn = resolve; });
  const first = journal.withOwnerLock(OWNER, async () => { firstIn(); await firstHeld; });
  await firstInside; let otherRan = false;
  await journal.withOwnerLock(other, async () => { otherRan = true; });
  assert.equal(otherRan, true); releaseFirst(); await first;
  // The other family is inside the kernel lock before Stargate starts; Stargate is seen refused on that very lock before it lets go.
  const order: string[] = []; let release!: () => void, entered!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const inside = new Promise<void>(resolve => { entered = resolve; });
  const family = state.withLocks([evmAddressLock(OWNER)], async () => { order.push("other-family"); entered(); await held; order.push("other-family-done"); });
  await inside;
  const blocked = locks.refused(evmAddressLock(OWNER)), stargate = journal.withOwnerLock(OWNER, async () => { order.push("stargate"); });
  await blocked; assert.deepEqual(order, ["other-family"]);
  release(); await Promise.all([family, stargate]);
  assert.deepEqual(order, ["other-family", "other-family-done", "stargate"]);
});

test("BRDG-32: a source receipt already proven at safe finality is not re-read while the destination is pending", async () => {
  const s = setup(); let pending = true, receiptReads = 0;
  const observeDestination = s.ports.observeDestination, waitSourceReceipt = s.ports.waitSourceReceipt;
  (s.ports as any).observeDestination = async (input: Parameters<typeof observeDestination>[0]) => pending ? null : observeDestination(input);
  (s.ports as any).waitSourceReceipt = async (...args: Parameters<typeof waitSourceReceipt>) => { receiptReads++; return waitSourceReceipt(...args); };
  const prepared = await prepareStargateV2Token(request({ idempotencyKey: "brdg32-saved-source" }), s.ports, s.journal);
  const submitted = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(submitted.phase, "submitted"); assert.ok(submitted.sourceReceipt); assert.ok(submitted.residualAllowanceAtomic !== undefined);
  const before = receiptReads; pending = false;
  const observed = await observeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(observed.phase, "observed"); assert.equal(receiptReads, before);
});
