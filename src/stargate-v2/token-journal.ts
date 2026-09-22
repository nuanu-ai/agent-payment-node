import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { decodeFunctionData } from "viem";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import { STARGATE_SEND_ABI } from "./abi.js";
import {
  assertStargateV2LegacyRouteFinalityPolicy, assertStargateV2RouteFinalityPolicy,
  stargateV2LegacyRouteFinalityPolicy,
} from "./finality-policy.js";
import {
  STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS, STARGATE_TOKEN_DESTINATION_CHAIN,
  STARGATE_TOKEN_DESTINATION_EID, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN,
  STARGATE_TOKEN_MAX_BRIDGE_GAS, STARGATE_TOKEN_MECHANISM, STARGATE_TOKEN_SOURCE_CHAIN,
  STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS,
  STARGATE_TOKEN_SOURCE_EID, STARGATE_TOKEN_SOURCE_EXECUTOR, STARGATE_TOKEN_SOURCE_POOL,
  STARGATE_TOKEN_SOURCE_TOKEN, UINT, address, fail,
} from "./token-codec.js";
import type {
  StargateTokenJournal, StargateTokenOperation, StargateTokenPhase, StargateTokenPostApprovalQuote,
  StargateTokenUsageState,
} from "./token-model.js";
import { assertLane } from "./token-rpc.js";

export class FileStargateTokenJournal implements StargateTokenJournal {
  private readonly locks: Pick<StateStore, "initialize" | "withLocks">;
  constructor(private readonly root: string, locks?: Pick<StateStore, "initialize" | "withLocks">) { this.locks = locks ?? new StateStore(root, { lockWaitMs: 0 }); }
  private path(id: string) { if (!/^[a-f0-9]{64}$/u.test(id)) fail("APN_STATE_CORRUPT", "operation_id"); return join(this.root, "stargate-v2-token", `${id}.json`); }
  async withLock<T>(id: string, work: () => Promise<T>) { await this.locks.initialize(); return await this.locks.withLocks([`stargate-token:${id}`], work, { waitMs: 30_000 }); }
  async withOwnerChainLock<T>(owner: Address, chainId: number, work: () => Promise<T>) { await this.locks.initialize();
    return await this.locks.withLocks([`stargate-source:${chainId}:${address(owner).toLowerCase()}`], work, { waitMs: 30_000 }); }
  async load(id: string) { try { const path = this.path(id); await secureDirectory(dirname(path), false); const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("APN_STATE_CORRUPT", "journal_file_mode");
    return validateRecord(JSON.parse(await readFile(path, "utf8"))); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } }
  async save(nextInput: StargateTokenOperation) { const next = validateRecord(nextInput), path = this.path(next.operationId), previous = await this.load(next.operationId);
    validateAdvance(previous, next); const directory = dirname(path); await secureDirectory(directory); const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temp, "wx", 0o600); try { await handle.writeFile(`${canonicalJson(next)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, path); const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); } }
}
async function secureDirectory(directory: string, create = true) { if (create) await mkdir(directory, { recursive: true, mode: 0o700 }); const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("APN_STATE_CORRUPT", "journal_directory_mode");
  if (relative(await realpath(dirname(directory)), await realpath(directory)).startsWith("..")) fail("APN_STATE_CORRUPT", "journal_path"); }

export function transition(op: StargateTokenOperation | Omit<StargateTokenOperation, "integrityHash">, phase: StargateTokenPhase, reason: string, at: number) { return seal({ ...op, phase, transitions: [...op.transitions, { phase, at: new Date(at).toISOString(), reason }] }); }
export function seal(value: Omit<StargateTokenOperation, "integrityHash"> | StargateTokenOperation): StargateTokenOperation { const { integrityHash: _old, ...body } = value as StargateTokenOperation; return Object.freeze({ ...body, integrityHash: hashObject(body) }); }
function validatePostApprovalQuote(op: StargateTokenOperation, snapshot: StargateTokenPostApprovalQuote): void {
  const { snapshotHash, ...body } = snapshot;
  const { quoteHash, ...quoteBody } = snapshot.quote;
  const validIso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
  if (snapshot.schemaVersion !== "apn.stargate-v2-token-post-approval-quote.v1" || hashObject(body) !== snapshotHash ||
    hashObject(quoteBody) !== quoteHash || canonicalJson(snapshot.quoteBlock) !== canonicalJson(snapshot.quote.block)) fail("APN_STATE_CORRUPT", "post_approval_quote_integrity");
  try { assertLane(snapshot.quote); } catch { fail("APN_STATE_CORRUPT", "post_approval_quote_lane"); }
  if (!validIso(snapshot.quotedAt) || !validIso(snapshot.expiresAt) || snapshot.quote.recipient !== op.recipient ||
    snapshot.quote.quote.requestedAmountAtomic !== op.amountAtomic || snapshot.quote.quote.amountSentAtomic !== op.amountAtomic ||
    snapshot.ownerApprovedMinimumOutputAtomic !== op.minOutputAtomic ||
    snapshot.ownerApprovedMaximumQuoteLossAtomic !== (BigInt(op.amountAtomic) - BigInt(op.minOutputAtomic)).toString() ||
    BigInt(snapshot.quote.quote.minimumOutputAtomic) < BigInt(op.minOutputAtomic) ||
    canonicalJson(snapshot.finalityPolicy) !== canonicalJson(op.finalityPolicy) || canonicalJson(snapshot.policy) !== canonicalJson(op.policy) ||
    BigInt(snapshot.executorNativeCapAtomic) < BigInt(op.nativeDropAtomic) || snapshot.sourceCodeHash !== op.sourceCodeHash ||
    snapshot.destinationCodeHash !== op.destinationCodeHash || snapshot.sourceTokenCodeHash !== op.sourceTokenCodeHash ||
    snapshot.destinationTokenCodeHash !== op.destinationTokenCodeHash || snapshot.sourceSnapshot.allowanceAtomic !== op.amountAtomic ||
    BigInt(snapshot.sourceSnapshot.tokenBalanceAtomic) < BigInt(op.amountAtomic) ||
    Date.parse(snapshot.quotedAt) < Date.parse(op.approvalSubmissionStartedAt!) || Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.quotedAt) ||
    Date.parse(snapshot.expiresAt) - Date.parse(snapshot.quotedAt) > STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS ||
    Date.parse(snapshot.expiresAt) > Date.parse(op.approvalFinalityDeadline!)) fail("APN_STATE_CORRUPT", "post_approval_quote_binding");
  const envelope = snapshot.sendEnvelope;
  if (envelope.chainId !== 10 || envelope.from !== op.owner || envelope.to !== STARGATE_TOKEN_SOURCE_POOL ||
    envelope.valueAtomic !== snapshot.quote.quote.nativeMessageFeeAtomic || envelope.nonceAtomic !== snapshot.sourceSnapshot.nonceAtomic ||
    BigInt(envelope.nonceAtomic) !== BigInt(op.approvalEnvelope!.nonceAtomic) + 1n ||
    envelope.gasLimitAtomic !== op.bridgeSimulation!.gasCeilingAtomic || envelope.maxFeePerGasAtomic !== op.feeApproval!.approvedMaxFeePerGasWei ||
    envelope.maxPriorityFeePerGasAtomic !== op.feeApproval!.approvedMaxPriorityFeePerGasWei ||
    BigInt(snapshot.sourceSnapshot.quotedMaxPriorityFeePerGasWei) > BigInt(snapshot.sourceSnapshot.quotedMaxFeePerGasWei) ||
    BigInt(snapshot.sourceSnapshot.quotedMaxFeePerGasWei) > BigInt(op.feeApproval!.approvedMaxFeePerGasWei) ||
    BigInt(snapshot.sourceSnapshot.quotedMaxPriorityFeePerGasWei) > BigInt(op.feeApproval!.approvedMaxPriorityFeePerGasWei) ||
    BigInt(snapshot.bridgeEstimateGasAtomic) > BigInt(envelope.gasLimitAtomic)) fail("APN_STATE_CORRUPT", "post_approval_envelope_binding");
  const approvalDebit = BigInt(op.approvalEnvelope!.gasLimitAtomic) * BigInt(op.approvalEnvelope!.maxFeePerGasAtomic);
  const maximumDebit = approvalDebit + BigInt(envelope.valueAtomic) + BigInt(envelope.gasLimitAtomic) * BigInt(envelope.maxFeePerGasAtomic);
  if (maximumDebit.toString() !== snapshot.maximumDebitAtomic || maximumDebit > BigInt(op.maxNativeDebitAtomic) ||
    BigInt(snapshot.sourceSnapshot.nativeBalanceAtomic) < BigInt(envelope.valueAtomic) + BigInt(envelope.gasLimitAtomic) * BigInt(envelope.maxFeePerGasAtomic))
    fail("APN_STATE_CORRUPT", "post_approval_debit_binding");
  const decoded = decodeFunctionData({ abi: STARGATE_SEND_ABI, data: envelope.data });
  if (decoded.functionName !== "sendToken" || decoded.args[0].amountLD.toString() !== op.amountAtomic ||
    decoded.args[0].minAmountLD.toString() !== snapshot.quote.quote.minimumOutputAtomic || decoded.args[0].extraOptions !== op.options ||
    decoded.args[1].nativeFee.toString() !== snapshot.quote.quote.nativeMessageFeeAtomic || decoded.args[2] !== op.owner)
    fail("APN_STATE_CORRUPT", "post_approval_calldata_binding");
}
export function validateRecord(value: unknown): StargateTokenOperation { if (!isPlainRecord(value) || !["apn.stargate-v2-token-operation.v1", "apn.stargate-v2-token-operation.v2", "apn.stargate-v2-token-operation.v3", "apn.stargate-v2-token-operation.v4", "apn.stargate-v2-token-operation.v5"].includes(String(value.schemaVersion))) fail("APN_STATE_CORRUPT", "schema"); const raw = value as unknown as StargateTokenOperation, { integrityHash, ...body } = raw; if (hashObject(body) !== integrityHash || raw.transitions.at(-1)?.phase !== raw.phase || raw.operationId.length !== 64) fail("APN_STATE_CORRUPT", "integrity");
  let record = raw;
  if (raw.schemaVersion === "apn.stargate-v2-token-operation.v1") { assertLegacyTokenLane(raw);
    if (raw.finalityPolicy === undefined && raw.finalityPolicyProvenance === undefined) record = seal({ ...body, finalityPolicy: stargateV2LegacyRouteFinalityPolicy(STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_DESTINATION_CHAIN), finalityPolicyProvenance: "derived_legacy_v1" } as StargateTokenOperation); else { assertStargateV2LegacyRouteFinalityPolicy(raw.finalityPolicy, STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_DESTINATION_CHAIN); if (raw.finalityPolicyProvenance !== "derived_legacy_v1") fail("APN_STATE_CORRUPT", "finality_policy_provenance"); }
  } else { assertStargateV2RouteFinalityPolicy(raw.finalityPolicy, STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_DESTINATION_CHAIN); if (raw.finalityPolicyProvenance !== "pinned_v2") fail("APN_STATE_CORRUPT", "finality_policy_provenance"); }
  if (raw.schemaVersion === "apn.stargate-v2-token-operation.v3" || raw.schemaVersion === "apn.stargate-v2-token-operation.v4" || raw.schemaVersion === "apn.stargate-v2-token-operation.v5") {
    const simulation = raw.bridgeSimulation;
    const approvalDebit = raw.approvalEnvelope === undefined ? 0n : BigInt(raw.approvalEnvelope.gasLimitAtomic) * BigInt(raw.approvalEnvelope.maxFeePerGasAtomic);
    const totalDebit = approvalDebit + BigInt(raw.sendEnvelope.valueAtomic) + BigInt(raw.sendEnvelope.gasLimitAtomic) * BigInt(raw.sendEnvelope.maxFeePerGasAtomic);
    if (simulation === undefined || simulation.gasCeilingAtomic !== raw.sendEnvelope.gasLimitAtomic || BigInt(simulation.gasCeilingAtomic) < 1n || BigInt(simulation.gasCeilingAtomic) > STARGATE_TOKEN_MAX_BRIDGE_GAS ||
      totalDebit.toString() !== raw.maximumDebitAtomic || totalDebit > BigInt(raw.maxNativeDebitAtomic) ||
      (raw.allowanceRequired ? simulation.mode !== "pending_post_approval" || simulation.prepareStatus !== "pending_post_approval" || raw.initialAllowanceAtomic !== "0" || raw.approvalEnvelope === undefined ||
        BigInt(raw.sendEnvelope.nonceAtomic) !== BigInt(raw.approvalEnvelope.nonceAtomic) + 1n || raw.sendEnvelope.maxFeePerGasAtomic !== raw.approvalEnvelope.maxFeePerGasAtomic || raw.sendEnvelope.maxPriorityFeePerGasAtomic !== raw.approvalEnvelope.maxPriorityFeePerGasAtomic
        : simulation.mode !== "exact_at_prepare" || simulation.prepareStatus !== "succeeded" || raw.initialAllowanceAtomic !== raw.amountAtomic || raw.approvalEnvelope !== undefined)) fail("APN_STATE_CORRUPT", "bridge_simulation_binding");
    if (raw.schemaVersion === "apn.stargate-v2-token-operation.v4" || raw.schemaVersion === "apn.stargate-v2-token-operation.v5") {
      const fees = raw.feeApproval;
      const validStoredUint = (input: unknown, positive = false) => typeof input === "string" && UINT.test(input) && BigInt(input) < 1n << 256n && (!positive || BigInt(input) > 0n);
      if (fees === undefined || !["exact_snapshot", "owner_ceiling"].includes(fees.provenance) ||
        !validStoredUint(fees.quotedMaxFeePerGasWei, true) || !validStoredUint(fees.quotedMaxPriorityFeePerGasWei) ||
        !validStoredUint(fees.approvedMaxFeePerGasWei, true) || !validStoredUint(fees.approvedMaxPriorityFeePerGasWei) ||
        BigInt(fees.quotedMaxPriorityFeePerGasWei) > BigInt(fees.quotedMaxFeePerGasWei) ||
        BigInt(fees.quotedMaxFeePerGasWei) > BigInt(fees.approvedMaxFeePerGasWei) ||
        BigInt(fees.quotedMaxPriorityFeePerGasWei) > BigInt(fees.approvedMaxPriorityFeePerGasWei) ||
        BigInt(fees.approvedMaxPriorityFeePerGasWei) > BigInt(fees.approvedMaxFeePerGasWei) ||
        raw.sendEnvelope.maxFeePerGasAtomic !== fees.approvedMaxFeePerGasWei || raw.sendEnvelope.maxPriorityFeePerGasAtomic !== fees.approvedMaxPriorityFeePerGasWei ||
        (raw.approvalEnvelope !== undefined && (raw.approvalEnvelope.maxFeePerGasAtomic !== fees.approvedMaxFeePerGasWei || raw.approvalEnvelope.maxPriorityFeePerGasAtomic !== fees.approvedMaxPriorityFeePerGasWei)) ||
        (fees.provenance === "exact_snapshot" && (fees.quotedMaxFeePerGasWei !== fees.approvedMaxFeePerGasWei || fees.quotedMaxPriorityFeePerGasWei !== fees.approvedMaxPriorityFeePerGasWei))) fail("APN_STATE_CORRUPT", "fee_approval_binding");
    } else if (raw.feeApproval !== undefined) fail("APN_STATE_CORRUPT", "legacy_fee_approval_field");
  } else if (raw.bridgeSimulation !== undefined || raw.feeApproval !== undefined) fail("APN_STATE_CORRUPT", "legacy_simulation_field");
  if (raw.schemaVersion === "apn.stargate-v2-token-operation.v5") {
    if (raw.approvalFinalityWindowMs !== STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS) fail("APN_STATE_CORRUPT", "approval_finality_window");
    const attemptedApproval = raw.approvalTransactionHash !== undefined;
    if (!raw.allowanceRequired && (raw.approvalSubmissionStartedAt !== undefined || raw.approvalFinalityDeadline !== undefined || raw.postApprovalQuote !== undefined))
      fail("APN_STATE_CORRUPT", "unexpected_approval_finality");
    if (attemptedApproval) {
      const validIso = (input: string | undefined) => input !== undefined && Number.isFinite(Date.parse(input)) && new Date(Date.parse(input)).toISOString() === input;
      if (!validIso(raw.approvalSubmissionStartedAt) || !validIso(raw.approvalFinalityDeadline) ||
        Date.parse(raw.approvalSubmissionStartedAt!) >= Date.parse(raw.expiresAt) ||
        Date.parse(raw.approvalFinalityDeadline!) - Date.parse(raw.approvalSubmissionStartedAt!) !== STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS)
        fail("APN_STATE_CORRUPT", "approval_finality_deadline");
      const marker = raw.transitions.find(entry => entry.phase === "allowance_submission_started");
      if (marker?.at !== raw.approvalSubmissionStartedAt) fail("APN_STATE_CORRUPT", "approval_submission_marker");
    } else if (raw.approvalSubmissionStartedAt !== undefined || raw.approvalFinalityDeadline !== undefined) fail("APN_STATE_CORRUPT", "approval_finality_without_attempt");
    if (raw.postApprovalQuote !== undefined) validatePostApprovalQuote(raw, raw.postApprovalQuote);
    if (["post_approval_quote_bound", "submission_started", "submitted", "unknown_finality", "observed"].includes(raw.phase) && raw.allowanceRequired && raw.postApprovalQuote === undefined)
      fail("APN_STATE_CORRUPT", "post_approval_quote_required");
  } else if (raw.approvalFinalityWindowMs !== undefined || raw.approvalSubmissionStartedAt !== undefined ||
    raw.approvalFinalityDeadline !== undefined || raw.postApprovalQuote !== undefined) fail("APN_STATE_CORRUPT", "legacy_approval_finality_field");
  const usageStates: readonly StargateTokenUsageState[] = ["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert"];
  if ((record.usageState !== undefined && !usageStates.includes(record.usageState)) || (record.usageTarget !== undefined && !usageStates.includes(record.usageTarget))) fail("APN_STATE_CORRUPT", "usage_state");
  if (canonicalJson(record.policy.mechanism) !== canonicalJson(STARGATE_TOKEN_MECHANISM)) fail("APN_STATE_CORRUPT", "mechanism_pin");
  if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(record.phase) &&
    (record.cleanupEnvelope === undefined || record.cleanupTransactionHash === undefined)) fail("APN_STATE_CORRUPT", "cleanup_marker");
  if (record.phase === "cleaned" && record.cleanupTransactionHash !== undefined && record.cleanupEnvelope === undefined) fail("APN_STATE_CORRUPT", "cleanup_marker");
  if (record.phase === "cleaned" && record.residualAllowanceAtomic !== "0") fail("APN_STATE_CORRUPT", "cleanup_residual");
  const allowed: Readonly<Partial<Record<StargateTokenPhase, readonly StargateTokenPhase[]>>> = {
    prepared: ["approved"], approved: ["allowance_submission_started", "submission_started", "cleanup_required"],
    allowance_submission_started: ["allowance_submitted", "allowance_unknown_finality", "cleanup_required"],
    allowance_submitted: ["allowance_unknown_finality", "allowance_observed", "cleanup_required"], allowance_unknown_finality: ["allowance_observed", "cleanup_required"],
    allowance_observed: ["post_approval_quote_bound", "submission_started", "cleanup_required"], post_approval_quote_bound: ["submission_started", "cleanup_required"], submission_started: ["submitted", "unknown_finality", "cleanup_required"],
    submitted: ["unknown_finality", "observed", "cleanup_required"], unknown_finality: ["submitted", "observed", "cleanup_required"], observed: [],
    cleanup_required: ["cleanup_submission_started", "cleaned", "observed"], cleanup_submission_started: ["cleanup_submitted", "cleanup_unknown_finality"],
    cleanup_submitted: ["cleanup_unknown_finality", "cleaned", "observed"], cleanup_unknown_finality: ["cleaned", "observed"], cleaned: [],
  };
  if (record.transitions[0]?.phase !== "prepared") fail("APN_STATE_CORRUPT", "transition");
  for (let i = 1; i < record.transitions.length; i++) if (!allowed[record.transitions[i - 1]!.phase]?.includes(record.transitions[i]!.phase)) fail("APN_STATE_CORRUPT", "transition");
  return record; }
function assertLegacyTokenLane(record: StargateTokenOperation) { const route = record.quote?.route, approval = record.approvalEnvelope, cleanup = record.cleanupEnvelope; if (record.recipient !== record.owner || record.sourceToken !== STARGATE_TOKEN_SOURCE_TOKEN || record.destinationToken !== STARGATE_TOKEN_DESTINATION_TOKEN || record.sourcePool !== STARGATE_TOKEN_SOURCE_POOL || record.destinationPool !== STARGATE_TOKEN_DESTINATION_POOL || record.sourceEid !== STARGATE_TOKEN_SOURCE_EID || record.destinationEid !== STARGATE_TOKEN_DESTINATION_EID || record.executor !== STARGATE_TOKEN_SOURCE_EXECUTOR || record.sendEnvelope?.chainId !== STARGATE_TOKEN_SOURCE_CHAIN || record.sendEnvelope.from !== record.owner || record.sendEnvelope.to !== STARGATE_TOKEN_SOURCE_POOL || (approval !== undefined && (approval.chainId !== STARGATE_TOKEN_SOURCE_CHAIN || approval.from !== record.owner || approval.to !== STARGATE_TOKEN_SOURCE_TOKEN)) || (cleanup !== undefined && (cleanup.chainId !== STARGATE_TOKEN_SOURCE_CHAIN || cleanup.from !== record.owner || cleanup.to !== STARGATE_TOKEN_SOURCE_TOKEN)) || route?.sourceChainId !== STARGATE_TOKEN_SOURCE_CHAIN || route?.destinationChainId !== STARGATE_TOKEN_DESTINATION_CHAIN || route?.sourceEid !== STARGATE_TOKEN_SOURCE_EID || route?.destinationEid !== STARGATE_TOKEN_DESTINATION_EID || route?.sourcePool !== STARGATE_TOKEN_SOURCE_POOL || route?.destinationPool !== STARGATE_TOKEN_DESTINATION_POOL || route?.sourceToken !== STARGATE_TOKEN_SOURCE_TOKEN || route?.destinationToken !== STARGATE_TOKEN_DESTINATION_TOKEN || record.quote?.recipient !== record.owner || route?.asset !== "USDC") fail("APN_STATE_CORRUPT", "legacy_lane"); }
function validateAdvance(previous: StargateTokenOperation | null, next: StargateTokenOperation) { if (previous === null) { if (next.phase !== "prepared" || next.transitions.length !== 1) fail("APN_STATE_CORRUPT", "initial"); return; }
  const frozen = (x: StargateTokenOperation) => { const { phase: _p, transitions: _t, integrityHash: _i, approvalTransactionHash: _a, transactionHash: _h,
    residualAllowanceAtomic: _r, sourceReceipt: _s, destinationEvidence: _d, cleanupEnvelope: _ce, cleanupTransactionHash: _ch,
    cleanupReason: _cr, usageState: _us, usageTarget: _ut, approvalSubmissionStartedAt: _asa, approvalFinalityDeadline: _afd,
    postApprovalQuote: _paq, ...rest } = x; return rest; };
  if (canonicalJson(frozen(previous)) !== canonicalJson(frozen(next)) || next.transitions.length < previous.transitions.length || canonicalJson(next.transitions.slice(0, previous.transitions.length)) !== canonicalJson(previous.transitions) || (previous.approvalTransactionHash !== undefined && previous.approvalTransactionHash !== next.approvalTransactionHash) || (previous.transactionHash !== undefined && previous.transactionHash !== next.transactionHash) ||
    (previous.cleanupEnvelope !== undefined && canonicalJson(previous.cleanupEnvelope) !== canonicalJson(next.cleanupEnvelope)) ||
    (previous.cleanupTransactionHash !== undefined && previous.cleanupTransactionHash !== next.cleanupTransactionHash) ||
    (previous.cleanupReason !== undefined && previous.cleanupReason !== next.cleanupReason) ||
    (previous.approvalSubmissionStartedAt !== undefined && previous.approvalSubmissionStartedAt !== next.approvalSubmissionStartedAt) ||
    (previous.approvalFinalityDeadline !== undefined && previous.approvalFinalityDeadline !== next.approvalFinalityDeadline) ||
    (previous.postApprovalQuote !== undefined && canonicalJson(previous.postApprovalQuote) !== canonicalJson(next.postApprovalQuote))) fail("APN_STATE_CORRUPT", "journal_rewrite");
  if (previous.usageTarget !== undefined && next.usageTarget !== previous.usageTarget &&
    !(previous.usageTarget === "reserved" && next.usageTarget === "failed_before_effect") &&
    !(next.usageTarget === undefined && next.usageState !== undefined)) fail("APN_STATE_CORRUPT", "usage_target_rewrite");
  const allowedUsage: Readonly<Partial<Record<StargateTokenUsageState, readonly StargateTokenUsageState[]>>> = {
    reserved: ["submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert"],
    submitted: ["unknown_finality", "finalized", "failed_confirmed_revert"], unknown_finality: ["finalized", "failed_confirmed_revert"],
    finalized: [], failed_before_effect: [], failed_confirmed_revert: [],
  };
  if (previous.usageState !== undefined && next.usageState !== previous.usageState && !allowedUsage[previous.usageState]?.includes(next.usageState!)) fail("APN_STATE_CORRUPT", "usage_state_rewrite"); }
export function stargateV2TokenCanonicalReceipt(input: StargateTokenOperation) { const op = validateRecord(input); if (op.phase !== "observed" || op.sourceReceipt === undefined || op.destinationEvidence === undefined || op.residualAllowanceAtomic !== "0" || op.usageState !== "finalized" || op.usageTarget !== undefined) fail("APN_OPERATION_BLOCKED", "receipt_not_observed");
  const effectiveQuote = op.postApprovalQuote?.quote ?? op.quote;
  const body = { schemaVersion: op.schemaVersion === "apn.stargate-v2-token-operation.v5" ? "apn.stargate-v2-token-receipt.v2" as const : "apn.stargate-v2-token-receipt.v1" as const, operationId: op.operationId, profile: op.profile,
    route: { sourceChainId: 10, sourceEid: 30111, sourcePool: op.sourcePool, sourceToken: op.sourceToken, destinationChainId: 137, destinationEid: 30109, destinationPool: op.destinationPool, destinationToken: op.destinationToken },
    owner: op.owner, recipient: op.recipient, principalAtomic: op.amountAtomic, minimumOutputAtomic: effectiveQuote.quote.minimumOutputAtomic,
    nativeDropAtomic: op.nativeDropAtomic, nativeMessageFeeAtomic: effectiveQuote.quote.nativeMessageFeeAtomic,
    maximumDebitAtomic: op.postApprovalQuote?.maximumDebitAtomic ?? op.maximumDebitAtomic,
    options: op.options, executor: op.executor, executorNativeCapAtomic: op.postApprovalQuote?.executorNativeCapAtomic ?? op.executorNativeCapAtomic, policy: op.policy,
    finalityPolicy: op.finalityPolicy, quoteHash: effectiveQuote.quoteHash,
    ...(op.schemaVersion === "apn.stargate-v2-token-operation.v5" ? { quoteLifecycle: {
      ownerApprovedMinimumOutputAtomic: op.minOutputAtomic,
      ownerApprovedMaximumQuoteLossAtomic: (BigInt(op.amountAtomic) - BigInt(op.minOutputAtomic)).toString(),
      initialQuotedOutputAtomic: op.quote.quote.minimumOutputAtomic,
      initialQuotedNativeMessageFeeAtomic: op.quote.quote.nativeMessageFeeAtomic,
      prepareQuoteHash: op.quote.quoteHash, prepareExpiresAt: op.expiresAt, approvalFinalityWindowMs: op.approvalFinalityWindowMs!,
      approvalSubmissionStartedAt: op.approvalSubmissionStartedAt ?? null, approvalFinalityDeadline: op.approvalFinalityDeadline ?? null,
      postApprovalQuoteHash: op.postApprovalQuote?.snapshotHash ?? null, postApprovalQuoteBlock: op.postApprovalQuote?.quoteBlock ?? null,
      postApprovalQuoteExpiresAt: op.postApprovalQuote?.expiresAt ?? null,
      postApprovalQuotedOutputAtomic: op.postApprovalQuote?.quote.quote.minimumOutputAtomic ?? null,
      postApprovalQuotedNativeMessageFeeAtomic: op.postApprovalQuote?.quote.quote.nativeMessageFeeAtomic ?? null } } : {}),
    feeApproval: op.feeApproval ?? { provenance: "legacy_exact_snapshot" as const, quotedMaxFeePerGasWei: op.sendEnvelope.maxFeePerGasAtomic, quotedMaxPriorityFeePerGasWei: op.sendEnvelope.maxPriorityFeePerGasAtomic, approvedMaxFeePerGasWei: op.sendEnvelope.maxFeePerGasAtomic, approvedMaxPriorityFeePerGasWei: op.sendEnvelope.maxPriorityFeePerGasAtomic },
    bridgeSimulation: op.bridgeSimulation ?? { mode: "legacy_exact_at_prepare" as const, prepareStatus: "legacy_succeeded" as const,
      gasCeilingAtomic: op.sendEnvelope.gasLimitAtomic },
    approvalTransactionHash: op.approvalTransactionHash ?? null, residualAllowanceAtomic: op.residualAllowanceAtomic, source: op.sourceReceipt, destination: op.destinationEvidence };
  return Object.freeze({ ...body, evidenceHash: hashObject(body) }); }
