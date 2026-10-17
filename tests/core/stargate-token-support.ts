import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import assert from "node:assert/strict";

/** The token Stargate execution fixture: an in-memory journal and scripted ports (shared by the execution and exit tests). */
export const KEY = `0x${"11".repeat(32)}` as Hex, ACCOUNT = privateKeyToAccount(KEY), OWNER = ACCOUNT.address;
export const BLOCK = `0x${"ab".repeat(32)}` as Hex, DEST_BLOCK = `0x${"cd".repeat(32)}` as Hex, GUID = `0x${"ef".repeat(32)}` as Hex;
export const AMOUNT = 100_000n, DROP = 50_000_000_000_000_000n, FEE = 1000n, NATIVE_CAP = 100_000_000_000_000_000n;
export const PACKET_NONCE = 7n;
export const packetPayload = (mutation?: "sender"|"receiver"|"guid") => (`0x01${PACKET_NONCE.toString(16).padStart(16,"0")}${(30111).toString(16).padStart(8,"0")}${(mutation==="sender"?OWNER:STARGATE_TOKEN_SOURCE_MESSAGING).slice(2).toLowerCase().padStart(64,"0")}${(30109).toString(16).padStart(8,"0")}${(mutation==="receiver"?OWNER:STARGATE_TOKEN_DESTINATION_MESSAGING).slice(2).toLowerCase().padStart(64,"0")}${(mutation==="guid"?BLOCK:GUID).slice(2)}00`) as Hex;
export function unreleasedV1TokenFixture(operation: StargateTokenOperation): StargateTokenOperation {
  const { integrityHash: _integrity, finalityPolicy: _policy, finalityPolicyProvenance: _provenance, bridgeSimulation: _simulation, feeApproval: _fees,
    approvalFinalityWindowMs: _window, approvalSubmissionStartedAt: _started, approvalFinalityDeadline: _deadline,
    postApprovalQuote: _post, ...current } = operation;
  const body = { ...current, schemaVersion: "apn.stargate-v2-token-operation.v1" as const };
  return { ...body, integrityHash: hashObject(body) } as unknown as StargateTokenOperation;
}
export function unreleasedV2TokenFixture(operation: StargateTokenOperation): StargateTokenOperation {
  const { integrityHash: _integrity, bridgeSimulation: _simulation, feeApproval: _fees, approvalFinalityWindowMs: _window,
    approvalSubmissionStartedAt: _started, approvalFinalityDeadline: _deadline, postApprovalQuote: _post, ...current } = operation;
  const body = { ...current, schemaVersion: "apn.stargate-v2-token-operation.v2" as const };
  return { ...body, integrityHash: hashObject(body) } as unknown as StargateTokenOperation;
}
export function unreleasedV3TokenFixture(operation: StargateTokenOperation): StargateTokenOperation {
  const { integrityHash: _integrity, feeApproval: _fees, approvalFinalityWindowMs: _window,
    approvalSubmissionStartedAt: _started, approvalFinalityDeadline: _deadline, postApprovalQuote: _post, ...current } = operation;
  const body = { ...current, schemaVersion: "apn.stargate-v2-token-operation.v3" as const };
  return { ...body, integrityHash: hashObject(body) } as unknown as StargateTokenOperation;
}
export async function seedTokenFixture(root: string, operation: StargateTokenOperation): Promise<void> {
  const directory = join(root, "stargate-v2-token"); await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${operation.operationId}.json`), `${canonicalJson(operation)}\n`, { mode: 0o600 });
}
export class MemoryJournal implements StargateTokenJournal { value: StargateTokenOperation | null = null; history: StargateTokenOperation[] = []; private tail = Promise.resolve(); private failed = false;
  constructor(private readonly failPhaseOnce?: string, private readonly failAfterSave = false) {}
  async load(id: string) { return this.value?.operationId === id ? structuredClone(this.value) : null; }
  async save(op: StargateTokenOperation) { if (this.failPhaseOnce === op.phase && !this.failed && !this.failAfterSave) { this.failed=true; throw new Error("journal crash"); }
    this.value = structuredClone(op); this.history.push(structuredClone(op)); if (this.failPhaseOnce === op.phase && !this.failed) { this.failed=true; throw new Error("journal crash"); } }
  async withLock<T>(_id: string, work: () => Promise<T>) { const prior = this.tail; let release!:()=>void; this.tail = new Promise<void>(r=>release=r); await prior; try { return await work(); } finally { release(); } }
  async withOwnerLock<T>(_owner: `0x${string}`, work: () => Promise<T>) { return await work(); }
  /** The in-memory journal has no operation index; the file journal's admission is covered by operation-index-families. */
  async admit<T>(_operation: unknown, work: () => Promise<T>) { return await work(); }
}
export function setup(options: { allowance?: bigint; nativeCap?: bigint; sendErrorAt?: number; legacy?: boolean; bridgeRevert?: boolean;
  residualAfterBridge?: boolean; advanceNonceOnSend?: boolean; preflightNonceDrift?: boolean; reserveError?: boolean; signErrorOnce?: boolean;
  bridgeSimulationRevert?: boolean; bridgeEstimateGas?: bigint; feeSpikeAfterApproval?: boolean; preparedMaxFee?: bigint; preparedPriority?: bigint; freshPriorityAfterApproval?: bigint;
  baseFeeBeforeApproval?: bigint; baseFeeAfterApproval?: bigint; postApprovalPreparedMaxFee?: bigint;
  approvalPendingPolls?: number; approveAdvancesMs?: number; postApprovalMinimumOutput?: bigint; postApprovalFee?: bigint;
  sourcePacketMutation?: "sender"|"receiver"|"guid";
  postApprovalNativeCap?: bigint; confirmPolicyErrorAfterApproval?: boolean; nowMs?: number; saveErrorPhaseOnce?: string; saveErrorAfterSave?: boolean;
  followErrorOnce?: "submitted"|"unknown_finality"|"finalized"|"failed_before_effect"|"failed_confirmed_revert";
  destinationMutation?: "guid"|"native"|"token" } = {}) {
  let allowance = options.allowance ?? 0n, approvalConsumed = false, sends = 0, signs = 0, approvals = 0, receiptCalls = 0, approvalPolls = 0, nonce = 7n;
  let nowMs = options.nowMs ?? 2_000_000_000_000;
  let preparedApprovals = 0, preparedBridges = 0, bridgeEstimates = 0, bridgeCalls = 0;
  let usageState: "reserved"|"submitted"|"unknown_finality"|"finalized"|"failed_before_effect"|"failed_confirmed_revert"|"released_unsubmitted" = "reserved", followFailed = false;
  const sourceCall: StargateTokenExecutionPorts["sourceCall"] = async (method, params) => {
    if (method === "eth_chainId") return "0xa";
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: BLOCK, baseFeePerGas: `0x${(approvalConsumed ? (options.feeSpikeAfterApproval ? 2n : options.baseFeeAfterApproval ?? 0n) : options.baseFeeBeforeApproval ?? 0n).toString(16)}` };
    if (method === "eth_getCode") return "0x60016000";
    if (method === "eth_getBalance") return "0x1fffffffffffff";
    if (method === "eth_getTransactionCount") return `0x${(options.preflightNonceDrift ? 8n : (approvalConsumed ? 8n : nonce)).toString(16)}`;
    if (method === "eth_maxPriorityFeePerGas") return `0x${(approvalConsumed && options.freshPriorityAfterApproval !== undefined ? options.freshPriorityAfterApproval : (options.preparedPriority ?? 1n)).toString(16)}`;
    if (method === "eth_estimateGas") { const data = (params[0] as { data: Hex }).data; let send = false;
      try { send = decodeFunctionData({ abi: STARGATE_SEND_ABI, data }).functionName === "sendToken"; } catch {}
      if (send) { bridgeEstimates++; if (allowance === 0n) throw new Error("0x7c75c3d2 Transfer_TransferFailed"); return `0x${(options.bridgeEstimateGas ?? 90_000n).toString(16)}`; }
      return "0x15f90"; }
    if (method !== "eth_call") throw new Error(`unexpected ${method}`);
    const data = (params[0] as { data: Hex }).data;
    try { const d = decodeFunctionData({ abi: STARGATE_QUOTE_ABI, data });
      if (d.functionName === "quoteOFT") { const received=approvalConsumed ? (options.postApprovalMinimumOutput ?? AMOUNT) : AMOUNT;
        return encodeAbiParameters(STARGATE_QUOTE_OFT_OUTPUT, [{ minAmountLD: 1n, maxAmountLD: 10_000_000n }, received===AMOUNT?[]:[{feeAmountLD:received-AMOUNT,description:"fresh quote degradation"}], { amountSentLD: AMOUNT, amountReceivedLD: received }]); }
      return encodeAbiParameters(STARGATE_QUOTE_SEND_OUTPUT, [{ nativeFee: approvalConsumed ? (options.postApprovalFee ?? FEE) : FEE, lzTokenFee: 0n }]);
    } catch { /* another ABI */ }
    try { const d = decodeFunctionData({ abi: LAYERZERO_EXECUTOR_ABI, data }); if (d.functionName === "dstConfig") return encodeFunctionResult({ abi: LAYERZERO_EXECUTOR_ABI, functionName: "dstConfig", result: [1n, 10000, 0n, approvalConsumed ? (options.postApprovalNativeCap ?? options.nativeCap ?? NATIVE_CAP) : (options.nativeCap ?? NATIVE_CAP), 1n] }); } catch {}
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
    if (d.functionName === "sendToken") { bridgeCalls++; if (options.bridgeSimulationRevert) throw new Error("sendToken reverted"); const received=approvalConsumed ? (options.postApprovalMinimumOutput ?? AMOUNT) : AMOUNT; return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sendToken", result: [{ guid: GUID, nonce: 1n, fee: { nativeFee: approvalConsumed ? (options.postApprovalFee ?? FEE) : FEE, lzTokenFee: 0n } }, { amountSentLD: AMOUNT, amountReceivedLD: received }, { ticketId: 0n, passengerBytes: "0x" }] }); }
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
  const journal = new MemoryJournal(options.saveErrorPhaseOnce, options.saveErrorAfterSave); const ports: StargateTokenExecutionPorts = { sourceCall, destinationCall,
    destinationBalances: async () => ({ tokenAtomic: "500000", nativeAtomic: "1000000000000000000", blockNumberAtomic: "9", blockHash: DEST_BLOCK }),
    prepareEnvelope: async tx => { let bridge = false; try { bridge = decodeFunctionData({ abi: STARGATE_SEND_ABI, data: tx.data }).functionName === "sendToken"; } catch {}
      if (bridge) { preparedBridges++; if (allowance === 0n) throw new Error("0x7c75c3d2 Transfer_TransferFailed"); } else preparedApprovals++;
      return { nonceAtomic: tx.nonceAtomic ?? (approvalConsumed ? "8" : "7"), gasLimitAtomic: "100000", maxFeePerGasAtomic: (approvalConsumed && options.postApprovalPreparedMaxFee !== undefined ? options.postApprovalPreparedMaxFee : options.preparedMaxFee ?? 2n).toString(), maxPriorityFeePerGasAtomic: (options.preparedPriority ?? 1n).toString(), nativeBalanceAtomic: "9000000000000000000" }; },
    signer: { kind: "imported_evm_signer", address: OWNER, signTransaction: async tx => { signs++; if (options.signErrorOnce && signs === 1) throw new Error("signing failed"); if (options.legacy) return await ACCOUNT.signTransaction({ type: "legacy", chainId: 10, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic), nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), gasPrice: BigInt(tx.maxFeePerGasAtomic) }); return await ACCOUNT.signTransaction({ type: "eip1559", chainId: 10, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic), nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), maxFeePerGas: BigInt(tx.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasAtomic), accessList: [] }); } },
    signerIdentity: async () => ({ profile: "owner", address: OWNER }), approve: async () => { approvals++; nowMs += options.approveAdvancesMs ?? 0; }, approveCleanup: async () => { approvals++; },
    admitPolicy: async () => ({ policyDigest: "a".repeat(64), policyRevision: 1, mechanism: STARGATE_TOKEN_MECHANISM }), confirmPolicy: async () => { if (approvalConsumed && options.confirmPolicyErrorAfterApproval) throw new Error("policy drift"); },
    reserveUsage: async () => { if (options.reserveError) throw new Error("usage cap race"); usageState = "reserved"; return usageState; },
    followUsage: async (_op, target) => { if (options.followErrorOnce === target && !followFailed) { followFailed = true; throw new Error("usage transition crash"); }
      usageState = target; return usageState; },
    sendRawTransaction: async raw => { sends++; if (options.sendErrorAt === sends) throw new Error("timeout"); if (options.advanceNonceOnSend) nonce++; return keccak256(raw); },
    waitSourceReceipt: async tx => { receiptCalls++; if (["cleanup_submission_started","cleanup_submitted","cleanup_unknown_finality"].includes(journal.value?.phase ?? "")) { allowance=0n; return { transactionHash:tx,status:"success",blockNumberAtomic:"22",blockHash:BLOCK,finality:"safe",logs:[] }; }
      if (!approvalConsumed && (options.allowance ?? 0n) === 0n) { approvalPolls++; if (approvalPolls <= (options.approvalPendingPolls ?? 0)) return null; allowance = AMOUNT; approvalConsumed = true; return { transactionHash: tx, status: "success", blockNumberAtomic: "20", blockHash: BLOCK, finality: "safe", logs: [] }; }
      if (options.bridgeRevert && receiptCalls === 1) return { transactionHash: tx, status: "reverted", blockNumberAtomic: "21", blockHash: BLOCK, finality: "safe", logs: [] };
      if (!options.residualAfterBridge || receiptCalls > 1) allowance = 0n; const topics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", args: { guid: GUID, fromAddress: OWNER } }) as readonly Hex[]; const received=approvalConsumed ? (options.postApprovalMinimumOutput ?? AMOUNT) : AMOUNT; const data = encodeAbiParameters(parseAbiParameters("uint32 dstEid,uint256 amountSentLD,uint256 amountReceivedLD"), [30109, AMOUNT, received]); const packetTopics=encodeEventTopics({abi:LAYERZERO_ENDPOINT_V2_ABI,eventName:"PacketSent"}) as readonly Hex[];const packetData=encodeAbiParameters(parseAbiParameters("bytes encodedPayload,bytes options,address sendLibrary"),[packetPayload(options.sourcePacketMutation),"0x",STARGATE_TOKEN_SOURCE_POOL]);return { transactionHash: tx, status: "success", blockNumberAtomic: "21", blockHash: BLOCK, finality: "safe", logs: [{ address: LAYERZERO_ENDPOINT_V2, topics:packetTopics,data:packetData },{ address: STARGATE_TOKEN_SOURCE_POOL, topics, data }] }; },
    observeDestination: async input => ({ emitter: STARGATE_TOKEN_DESTINATION_POOL, sourceTransactionHash: input.sourceTransactionHash, guid: options.destinationMutation === "guid" ? BLOCK : input.guid, sourceEid: 30111, destinationTransactionHash: DEST_BLOCK, logIndexAtomic: "0", blockNumberAtomic: "30", blockHash: DEST_BLOCK, finality: input.finalityTag, recipient: input.recipient, amountReceivedAtomic: (approvalConsumed ? (options.postApprovalMinimumOutput ?? AMOUNT) : AMOUNT).toString(), tokenBalanceBeforeAtomic: input.tokenBalanceBeforeAtomic, tokenBalanceAfterAtomic: (BigInt(input.tokenBalanceBeforeAtomic) + (options.destinationMutation === "token" ? 1n : BigInt(input.minimumAmountAtomic))).toString(), tokenDeltaAtomic: (options.destinationMutation === "token" ? 1n : BigInt(input.minimumAmountAtomic)).toString(), nativeBalanceBeforeAtomic: input.nativeBalanceBeforeAtomic, nativeBalanceAfterAtomic: (BigInt(input.nativeBalanceBeforeAtomic) + (options.destinationMutation === "native" ? 1n : DROP)).toString(), nativeDeltaAtomic: (options.destinationMutation === "native" ? 1n : DROP).toString(), nativeDrop: { executor: STARGATE_TOKEN_DESTINATION_EXECUTOR, nonceAtomic: PACKET_NONCE.toString(), success: true }, packetDelivery:{endpoint:LAYERZERO_ENDPOINT_V2,tokenMessaging:STARGATE_TOKEN_DESTINATION_MESSAGING,nonceAtomic:PACKET_NONCE.toString(),transactionHash:DEST_BLOCK,blockNumberAtomic:"30",blockHash:DEST_BLOCK,logIndexAtomic:"1"} }), now: () => nowMs };
  return { ports, journal, counts: () => ({ sends, signs, approvals }), simulations: () => ({ preparedApprovals, preparedBridges, bridgeEstimates, bridgeCalls }), advance: (ms:number) => { nowMs += ms; } };
}
export const request = (changes: Partial<Parameters<typeof prepareStargateV2Token>[0]> = {}) => ({ profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: AMOUNT.toString(), nativeDropAtomic: DROP.toString(), minOutputAtomic: "99000", maxNativeDebitAtomic: "10000000000000000", idempotencyKey: "stargate-token-001", ...changes });

