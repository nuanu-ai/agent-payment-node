import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, keccak256, parseAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { LAYERZERO_EXECUTOR_ABI, STARGATE_ERC20_ABI, STARGATE_QUOTE_ABI, STARGATE_QUOTE_OFT_OUTPUT, STARGATE_QUOTE_SEND_OUTPUT, STARGATE_SEND_ABI } from "../../src/stargate-v2/abi.js";
import { cleanupStargateV2Token, encodeStargateNativeDrop, executeStargateV2Token, FileStargateTokenJournal, observeStargateV2Token, prepareStargateV2Token, stargateV2TokenCanonicalReceipt,
  STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_MECHANISM,
  STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_SOURCE_EXECUTOR, STARGATE_TOKEN_SOURCE_POOL,
  STARGATE_TOKEN_SOURCE_TOKEN, type StargateTokenExecutionPorts, type StargateTokenJournal, type StargateTokenOperation } from "../../src/stargate-v2/token-execution.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const KEY = `0x${"11".repeat(32)}` as Hex, ACCOUNT = privateKeyToAccount(KEY), OWNER = ACCOUNT.address;
const BLOCK = `0x${"ab".repeat(32)}` as Hex, DEST_BLOCK = `0x${"cd".repeat(32)}` as Hex, GUID = `0x${"ef".repeat(32)}` as Hex;
const AMOUNT = 100_000n, DROP = 50_000_000_000_000_000n, FEE = 1000n, NATIVE_CAP = 100_000_000_000_000_000n;
function legacyTokenFixture(operation: StargateTokenOperation): StargateTokenOperation {
  const { integrityHash: _integrity, finalityPolicy: _policy, finalityPolicyProvenance: _provenance, ...current } = operation;
  const body = { ...current, schemaVersion: "apn.stargate-v2-token-operation.v1" as const };
  return { ...body, integrityHash: hashObject(body) } as StargateTokenOperation;
}
async function seedTokenFixture(root: string, operation: StargateTokenOperation): Promise<void> {
  const directory = join(root, "stargate-v2-token"); await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${operation.operationId}.json`), `${canonicalJson(operation)}\n`, { mode: 0o600 });
}
class MemoryJournal implements StargateTokenJournal { value: StargateTokenOperation | null = null; history: StargateTokenOperation[] = []; private tail = Promise.resolve();
  async load(id: string) { return this.value?.operationId === id ? structuredClone(this.value) : null; }
  async save(op: StargateTokenOperation) { this.value = structuredClone(op); this.history.push(structuredClone(op)); }
  async withLock<T>(_id: string, work: () => Promise<T>) { const prior = this.tail; let release!:()=>void; this.tail = new Promise<void>(r=>release=r); await prior; try { return await work(); } finally { release(); } }
  async withOwnerChainLock<T>(_owner: `0x${string}`, _chainId: number, work: () => Promise<T>) { return await work(); }
}
function setup(options: { allowance?: bigint; nativeCap?: bigint; sendErrorAt?: number; legacy?: boolean; bridgeRevert?: boolean;
  residualAfterBridge?: boolean; advanceNonceOnSend?: boolean; preflightNonceDrift?: boolean; reserveError?: boolean; signErrorOnce?: boolean;
  followErrorOnce?: "submitted"|"unknown_finality"|"finalized"|"failed_before_effect"|"failed_confirmed_revert";
  destinationMutation?: "guid"|"native"|"token" } = {}) {
  let allowance = options.allowance ?? 0n, approvalConsumed = false, sends = 0, signs = 0, approvals = 0, receiptCalls = 0, nonce = 7n;
  let usageState: "reserved"|"submitted"|"unknown_finality"|"finalized"|"failed_before_effect"|"failed_confirmed_revert" = "reserved", followFailed = false;
  const sourceCall: StargateTokenExecutionPorts["sourceCall"] = async (method, params) => {
    if (method === "eth_chainId") return "0xa";
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: BLOCK };
    if (method === "eth_getCode") return "0x60016000";
    if (method === "eth_getBalance") return "0x1fffffffffffff";
    if (method === "eth_getTransactionCount") return `0x${(options.preflightNonceDrift ? 8n : (approvalConsumed ? 8n : nonce)).toString(16)}`;
    if (method === "eth_estimateGas") return "0x15f90";
    if (method !== "eth_call") throw new Error(`unexpected ${method}`);
    const data = (params[0] as { data: Hex }).data;
    try { const d = decodeFunctionData({ abi: STARGATE_QUOTE_ABI, data });
      if (d.functionName === "quoteOFT") return encodeAbiParameters(STARGATE_QUOTE_OFT_OUTPUT, [{ minAmountLD: 1n, maxAmountLD: 10_000_000n }, [], { amountSentLD: AMOUNT, amountReceivedLD: AMOUNT }]);
      return encodeAbiParameters(STARGATE_QUOTE_SEND_OUTPUT, [{ nativeFee: FEE, lzTokenFee: 0n }]);
    } catch { /* another ABI */ }
    try { const d = decodeFunctionData({ abi: LAYERZERO_EXECUTOR_ABI, data }); if (d.functionName === "dstConfig") return encodeFunctionResult({ abi: LAYERZERO_EXECUTOR_ABI, functionName: "dstConfig", result: [1n, 10000, 0n, options.nativeCap ?? NATIVE_CAP, 1n] }); } catch {}
    try { const d = decodeFunctionData({ abi: STARGATE_ERC20_ABI, data });
      if (d.functionName === "allowance") return encodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "allowance", result: allowance });
      if (d.functionName === "balanceOf") return encodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", result: 1_000_000n });
      if (d.functionName === "approve") return encodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "approve", result: true });
    } catch {}
    const d = decodeFunctionData({ abi: STARGATE_SEND_ABI, data });
    if (d.functionName === "token") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "token", result: STARGATE_TOKEN_SOURCE_TOKEN });
    if (d.functionName === "localEid") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "localEid", result: 30111 });
    if (d.functionName === "sharedDecimals") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sharedDecimals", result: 6 });
    if (d.functionName === "status") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "status", result: 1 });
    if (d.functionName === "stargateType") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "stargateType", result: 0 });
    if (d.functionName === "sendToken") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sendToken", result: [{ guid: GUID, nonce: 1n, fee: { nativeFee: FEE, lzTokenFee: 0n } }, { amountSentLD: AMOUNT, amountReceivedLD: AMOUNT }, { ticketId: 0n, passengerBytes: "0x" }] });
    throw new Error("unknown call");
  };
  const destinationCall: StargateTokenExecutionPorts["destinationCall"] = async (method, params) => {
    if (method === "eth_chainId") return "0x89"; if (method === "eth_getCode") return "0x60026000"; if (method !== "eth_call") throw new Error(method);
    const d = decodeFunctionData({ abi: STARGATE_SEND_ABI, data: (params[0] as {data:Hex}).data });
    if (d.functionName === "token") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "token", result: STARGATE_TOKEN_DESTINATION_TOKEN });
    if (d.functionName === "localEid") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "localEid", result: 30109 });
    if (d.functionName === "sharedDecimals") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sharedDecimals", result: 6 });
    if (d.functionName === "status") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "status", result: 1 });
    if (d.functionName === "stargateType") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "stargateType", result: 0 }); throw new Error("dest");
  };
  const journal = new MemoryJournal(); const ports: StargateTokenExecutionPorts = { sourceCall, destinationCall,
    destinationBalances: async () => ({ tokenAtomic: "500000", nativeAtomic: "1000000000000000000", blockNumberAtomic: "9", blockHash: DEST_BLOCK }),
    prepareEnvelope: async tx => ({ nonceAtomic: tx.nonceAtomic ?? "7", gasLimitAtomic: "100000", maxFeePerGasAtomic: "2", maxPriorityFeePerGasAtomic: "1", nativeBalanceAtomic: "9000000000000000000" }),
    signer: { kind: "imported_evm_signer", address: OWNER, signTransaction: async tx => { signs++; if (options.signErrorOnce && signs === 1) throw new Error("signing failed"); if (options.legacy) return await ACCOUNT.signTransaction({ type: "legacy", chainId: 10, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic), nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), gasPrice: BigInt(tx.maxFeePerGasAtomic) }); return await ACCOUNT.signTransaction({ type: "eip1559", chainId: 10, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic), nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), maxFeePerGas: BigInt(tx.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasAtomic), accessList: [] }); } },
    signerIdentity: async () => ({ profile: "owner", address: OWNER }), approve: async () => { approvals++; }, approveCleanup: async () => { approvals++; },
    admitPolicy: async () => ({ policyDigest: "a".repeat(64), policyRevision: 1, mechanism: STARGATE_TOKEN_MECHANISM }), confirmPolicy: async () => {},
    reserveUsage: async () => { if (options.reserveError) throw new Error("usage cap race"); usageState = "reserved"; return usageState; },
    followUsage: async (_op, target) => { if (options.followErrorOnce === target && !followFailed) { followFailed = true; throw new Error("usage transition crash"); }
      usageState = target; return usageState; },
    sendRawTransaction: async raw => { sends++; if (options.sendErrorAt === sends) throw new Error("timeout"); if (options.advanceNonceOnSend) nonce++; return keccak256(raw); },
    waitSourceReceipt: async tx => { receiptCalls++; if (receiptCalls === 1 && (options.allowance ?? 0n) === 0n) { allowance = AMOUNT; approvalConsumed = true; return { transactionHash: tx, status: "success", blockNumberAtomic: "20", blockHash: BLOCK, finality: "safe", logs: [] }; }
      if (options.bridgeRevert && receiptCalls === 1) return { transactionHash: tx, status: "reverted", blockNumberAtomic: "21", blockHash: BLOCK, finality: "safe", logs: [] };
      if (!options.residualAfterBridge || receiptCalls > 1) allowance = 0n; const topics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", args: { guid: GUID, fromAddress: OWNER } }) as readonly Hex[]; const data = encodeAbiParameters(parseAbiParameters("uint32 dstEid,uint256 amountSentLD,uint256 amountReceivedLD"), [30109, AMOUNT, AMOUNT]); return { transactionHash: tx, status: "success", blockNumberAtomic: "21", blockHash: BLOCK, finality: "safe", logs: [{ address: STARGATE_TOKEN_SOURCE_POOL, topics, data }] }; },
    observeDestination: async input => ({ emitter: STARGATE_TOKEN_DESTINATION_POOL, sourceTransactionHash: input.sourceTransactionHash, guid: options.destinationMutation === "guid" ? BLOCK : input.guid, sourceEid: 30111, destinationTransactionHash: DEST_BLOCK, logIndexAtomic: "0", blockNumberAtomic: "30", blockHash: DEST_BLOCK, finality: input.finalityTag, recipient: input.recipient, amountReceivedAtomic: AMOUNT.toString(), tokenBalanceBeforeAtomic: input.tokenBalanceBeforeAtomic, tokenBalanceAfterAtomic: (BigInt(input.tokenBalanceBeforeAtomic) + (options.destinationMutation === "token" ? 1n : AMOUNT)).toString(), tokenDeltaAtomic: (options.destinationMutation === "token" ? 1n : AMOUNT).toString(), nativeBalanceBeforeAtomic: input.nativeBalanceBeforeAtomic, nativeBalanceAfterAtomic: (BigInt(input.nativeBalanceBeforeAtomic) + (options.destinationMutation === "native" ? 1n : DROP)).toString(), nativeDeltaAtomic: (options.destinationMutation === "native" ? 1n : DROP).toString(), nativeDrop: { executor: STARGATE_TOKEN_DESTINATION_EXECUTOR, nonceAtomic: "1", success: true } }), now: () => 2_000_000_000_000 };
  return { ports, journal, counts: () => ({ sends, signs, approvals }) };
}
const request = (changes: Partial<Parameters<typeof prepareStargateV2Token>[0]> = {}) => ({ profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: AMOUNT.toString(), nativeDropAtomic: DROP.toString(), minOutputAtomic: "99000", maxNativeDebitAtomic: "10000000000000000", idempotencyKey: "stargate-token-001", ...changes });

test("Type-3 native-drop bytes and pinned contracts are exact", () => { const encoded = encodeStargateNativeDrop(DROP.toString(), OWNER); assert.equal(encoded, `0x000301003102${DROP.toString(16).padStart(32,"0")}${OWNER.slice(2).toLowerCase().padStart(64,"0")}`); assert.equal(STARGATE_TOKEN_SOURCE_EXECUTOR, getAddress("0x2D2ea0697bdbede3F01553D2Ae4B8d0c486B666e")); });
test("prepare freezes fresh quote, cap, finality policy, least approval and send envelopes", async () => { const s=setup(), op=await prepareStargateV2Token(request(),s.ports,s.journal); assert.equal(op.schemaVersion,"apn.stargate-v2-token-operation.v2"); assert.equal(op.finalityPolicyProvenance,"pinned_v2"); assert.equal(op.allowanceRequired,true); assert.equal(op.approvalEnvelope?.nonceAtomic,"7"); assert.equal(op.sendEnvelope.nonceAtomic,"8"); assert.equal(op.sendEnvelope.valueAtomic,FEE.toString()); assert.deepEqual(op.finalityPolicy,{version:"apn.stargate-v2-finality.v1",source:{chainId:10,blockTag:"safe"},destination:{chainId:137,blockTag:"finalized"}}); const approval=decodeFunctionData({abi:STARGATE_ERC20_ABI,data:op.approvalEnvelope!.data}); assert.deepEqual(approval.args,[STARGATE_TOKEN_SOURCE_POOL,AMOUNT]); const send=decodeFunctionData({abi:STARGATE_SEND_ABI,data:op.sendEnvelope.data}); assert.equal(send.functionName,"sendToken"); if (send.functionName !== "sendToken") throw new Error("unexpected"); assert.equal(send.args[0].extraOptions,op.options); assert.equal(s.counts().sends,0); });
test("legacy v1 prepared token fixture loads locally with the historical all-safe policy", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize();
  const s=setup(), prepared=await prepareStargateV2Token(request({idempotencyKey:"legacy-token-prepared"}),s.ports,s.journal);
  await seedTokenFixture(temporary.root,legacyTokenFixture(prepared)); const loaded=await new FileStargateTokenJournal(temporary.root,state).load(prepared.operationId);
  assert.equal(loaded?.schemaVersion,"apn.stargate-v2-token-operation.v1"); assert.equal(loaded?.finalityPolicyProvenance,"derived_legacy_v1");
  assert.deepEqual(loaded?.finalityPolicy,{version:"apn.stargate-v2-finality.legacy-safe-v1",source:{chainId:10,blockTag:"safe"},destination:{chainId:137,blockTag:"safe"}});
  const journal=new FileStargateTokenJournal(temporary.root,state);
  await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,journal),(e:any)=>e.code==="APN_OPERATION_BLOCKED"&&e.details.reason==="legacy_operation_nonresumable");
  await assert.rejects(cleanupStargateV2Token(prepared.operationId,s.ports,journal),(e:any)=>e.code==="APN_OPERATION_BLOCKED"&&e.details.reason==="cleanup_not_required");
  assert.deepEqual(s.counts(),{sends:0,signs:0,approvals:0});
});
test("legacy v1 token unknown finality remains safe-only observation with no resend", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize();
  const s=setup({allowance:AMOUNT,sendErrorAt:1}),prepared=await prepareStargateV2Token(request({idempotencyKey:"legacy-token-unknown"}),s.ports,s.journal);
  const unknown=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(unknown.phase,"unknown_finality"); const before=s.counts();
  await seedTokenFixture(temporary.root,legacyTokenFixture(unknown)); const observed=await observeStargateV2Token(prepared.operationId,s.ports,new FileStargateTokenJournal(temporary.root,state));
  assert.equal(observed.phase,"observed"); assert.equal(observed.destinationEvidence?.finality,"safe"); assert.deepEqual(s.counts(),before);
});
test("legacy v1 token cleanup remains recoverable without resending the bridge", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize();
  const s=setup({allowance:AMOUNT,bridgeRevert:true}),prepared=await prepareStargateV2Token(request({idempotencyKey:"legacy-token-cleanup"}),s.ports,s.journal);
  const required=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(required.phase,"cleanup_required"); const before=s.counts();
  await seedTokenFixture(temporary.root,legacyTokenFixture(required)); const cleaned=await cleanupStargateV2Token(prepared.operationId,s.ports,new FileStargateTokenJournal(temporary.root,state));
  assert.equal(cleaned.phase,"cleaned"); assert.equal(s.counts().sends,before.sends+1); assert.equal(s.counts().signs,before.signs+1);
});
test("v2 token missing policy, policy drift, and ambiguous legacy lanes are corrupt before effects", async (t) => {
  const temporary=await temporaryState(); t.after(temporary.cleanup); const state=new StateStore(temporary.root); await state.initialize(); const journal=new FileStargateTokenJournal(temporary.root,state);
  const missingSetup=setup(),missing=await prepareStargateV2Token(request({idempotencyKey:"v2-token-missing-policy"}),missingSetup.ports,missingSetup.journal);
  const {integrityHash:_i,finalityPolicy:_p,finalityPolicyProvenance:_fp,...missingBody}=missing; await seedTokenFixture(temporary.root,{...missingBody,integrityHash:hashObject(missingBody)} as StargateTokenOperation);
  await assert.rejects(journal.load(missing.operationId),(e:any)=>e.code==="APN_STATE_CORRUPT");
  const driftSetup=setup(),driftOp=await prepareStargateV2Token(request({idempotencyKey:"v2-token-policy-drift"}),driftSetup.ports,driftSetup.journal);
  const {integrityHash:_di,...driftBody}={...driftOp,finalityPolicy:{...driftOp.finalityPolicy,destination:{chainId:137 as const,blockTag:"safe" as const}}}; await seedTokenFixture(temporary.root,{...driftBody,integrityHash:hashObject(driftBody)} as StargateTokenOperation);
  await assert.rejects(journal.load(driftOp.operationId),(e:any)=>e.code==="APN_STATE_CORRUPT");
  const laneSetup=setup(),laneOp=legacyTokenFixture(await prepareStargateV2Token(request({idempotencyKey:"legacy-token-lane-drift"}),laneSetup.ports,laneSetup.journal));
  const {integrityHash:_li,...laneBody}=structuredClone(laneOp),badLane={...laneBody,quote:{...laneBody.quote,route:{...laneBody.quote.route,destinationChainId:130}}}; await seedTokenFixture(temporary.root,{...badLane,integrityHash:hashObject(badLane)} as StargateTokenOperation);
  await assert.rejects(executeStargateV2Token(laneOp.operationId,laneSetup.ports,journal),(e:any)=>e.code==="APN_STATE_CORRUPT");
  const {integrityHash:_ei,...executorBody}=laneOp,badExecutor={...executorBody,executor:STARGATE_TOKEN_DESTINATION_EXECUTOR}; await seedTokenFixture(temporary.root,{...badExecutor,integrityHash:hashObject(badExecutor)} as StargateTokenOperation);
  await assert.rejects(executeStargateV2Token(laneOp.operationId,laneSetup.ports,journal),(e:any)=>e.code==="APN_STATE_CORRUPT");
  const {integrityHash:_ti,...targetBody}=laneOp,badTarget={...targetBody,sendEnvelope:{...targetBody.sendEnvelope,to:STARGATE_TOKEN_DESTINATION_POOL}}; await seedTokenFixture(temporary.root,{...badTarget,integrityHash:hashObject(badTarget)} as StargateTokenOperation);
  await assert.rejects(executeStargateV2Token(laneOp.operationId,laneSetup.ports,journal),(e:any)=>e.code==="APN_STATE_CORRUPT"); assert.deepEqual(laneSetup.counts(),{sends:0,signs:0,approvals:0});
});
test("zero native drop emits no options and remains cap checked", async () => { const s=setup({allowance:AMOUNT}), op=await prepareStargateV2Token(request({idempotencyKey:"token-only-route",nativeDropAtomic:"0"}),s.ports,s.journal); assert.equal(op.options,"0x"); assert.equal(op.nativeDropAtomic,"0"); });
test("existing exact allowance skips approval while residual or cap overflow fail closed", async () => { const exact=setup({allowance:AMOUNT}), op=await prepareStargateV2Token(request(),exact.ports,exact.journal); assert.equal(op.allowanceRequired,false); assert.equal(op.approvalEnvelope,undefined); await assert.rejects(prepareStargateV2Token(request({idempotencyKey:"residual-allowance"}),setup({allowance:1n}).ports,new MemoryJournal()), (e:any)=>e.details?.reason==="residual_allowance_cleanup_required"); await assert.rejects(prepareStargateV2Token(request({idempotencyKey:"native-cap-over"}),setup({nativeCap:DROP-1n}).ports,new MemoryJournal()), (e:any)=>e.details?.reason==="native_drop_cap_exceeded"); });
test("approval and bridge effects are separately marked, exact, observed, and canonical", async () => { const s=setup(), prepared=await prepareStargateV2Token(request(),s.ports,s.journal), observed=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"observed"); assert.equal(observed.residualAllowanceAtomic,"0"); assert.equal(observed.usageState,"finalized"); assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1}); assert.deepEqual(observed.transitions.map(x=>x.phase),["prepared","approved","allowance_submission_started","allowance_submitted","allowance_observed","submission_started","submitted","observed"]); assert.match(stargateV2TokenCanonicalReceipt(observed).evidenceHash,/^[a-f0-9]{64}$/u); });
test("ambiguous approval is durable and concurrent/repeated execute never resends", async () => { const s=setup({sendErrorAt:1}), prepared=await prepareStargateV2Token(request(),s.ports,s.journal); const [a,b]=await Promise.all([executeStargateV2Token(prepared.operationId,s.ports,s.journal),executeStargateV2Token(prepared.operationId,s.ports,s.journal)]); assert.equal(a.phase,"allowance_unknown_finality"); assert.equal(b.phase,"observed"); assert.deepEqual(s.counts(),{sends:2,signs:2,approvals:1}); assert.equal(s.journal.history.filter(x=>x.phase==="allowance_submission_started").length,1); });
test("observe recovers an ambiguous approval without signing or broadcasting the bridge", async () => { const s=setup({sendErrorAt:1}), prepared=await prepareStargateV2Token(request({idempotencyKey:"observe-only-approval"}),s.ports,s.journal); const unknown=await executeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(unknown.phase,"allowance_unknown_finality"); const observed=await observeStargateV2Token(prepared.operationId,s.ports,s.journal); assert.equal(observed.phase,"allowance_observed"); assert.deepEqual(s.counts(),{sends:1,signs:1,approvals:1}); });
test("legacy/type-confused envelope is rejected before any send and requires explicit cleanup", async () => { const s=setup({allowance:AMOUNT,legacy:true}), prepared=await prepareStargateV2Token(request(),s.ports,s.journal); await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),(e:any)=>e.details?.reason==="signed_transaction_envelope"); assert.equal(s.counts().sends,0); assert.equal(s.journal.value?.phase,"cleanup_required"); });
for (const mutation of ["guid","native","token"] as const) test(`destination ${mutation} mismatch cannot terminalize`, async () => { const s=setup({allowance:AMOUNT,destinationMutation:mutation}), prepared=await prepareStargateV2Token(request({idempotencyKey:`destination-${mutation}`}),s.ports,s.journal); await assert.rejects(executeStargateV2Token(prepared.operationId,s.ports,s.journal),(e:any)=>e.code==="APN_RPC_PROTOCOL"); assert.notEqual(s.journal.value?.phase,"observed"); });

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
  const second = await prepareStargateV2Token(request({ idempotencyKey: "same-owner-race-two" }), s.ports, journal);
  const [a, b] = await Promise.all([executeStargateV2Token(first.operationId, s.ports, journal), executeStargateV2Token(second.operationId, s.ports, journal)]);
  assert.equal([a.phase, b.phase].includes("observed"), true); assert.equal(s.counts().signs, 1); assert.equal(s.counts().sends, 1);
  assert.equal([a.phase, b.phase].some(phase => phase === "cleaned" || phase === "cleanup_required"), true);
});

test("owner-chain lock permits different owners or source chains to proceed concurrently", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const journal = new FileStargateTokenJournal(temporary.root);
  const other = getAddress("0x2222222222222222222222222222222222222222"); let active = 0, peak = 0;
  const work = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 20)); active--; };
  await Promise.all([journal.withOwnerChainLock(OWNER, 10, work), journal.withOwnerChainLock(other, 10, work), journal.withOwnerChainLock(OWNER, 1, work)]);
  assert.equal(peak, 3);
});
