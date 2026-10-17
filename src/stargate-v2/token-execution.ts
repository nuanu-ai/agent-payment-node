import { decodeFunctionResult, encodeFunctionData, keccak256, pad, type Hex } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import { canonicalProfile } from "../wallet-policy.js";
import { STARGATE_ERC20_ABI, STARGATE_SEND_ABI } from "./abi.js";
import { stargateV2RouteFinalityPolicy } from "./finality-policy.js";
import { createPostApprovalQuote, freshPreflight, sendFeeAdmitted } from "./token-preflight.js";
import { quoteStargateV2Direct } from "./quote.js";
import {
  MAX_TTL_MS, STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS, STARGATE_TOKEN_DESTINATION_CHAIN, STARGATE_TOKEN_DESTINATION_POOL,
  STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_MAX_BRIDGE_GAS,
  STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_SOURCE_EXECUTOR, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN,
  address, encodeStargateNativeDrop, fail, uint,
} from "./token-codec.js";
import { seal, transition } from "./token-journal.js";
import type {
  StargateTokenExecutionPorts, StargateTokenJournal, StargateTokenOperation, StargateTokenPostApprovalQuote,
  StargateTokenPreparationRequest, StargateTokenPreparedEnvelope, StargateTokenUsageState, StargateTokenEnvelope, StargateTokenSourceReceipt,
} from "./token-model.js";
import {
  assertLane, readAllowance, readExecutorCap, readPoolConfig, readPoolFunctional, readTokenBalance, requoteSend, rpcEnvelope,
  sourceReceipt, validateDestination, verifySignedEnvelope,
} from "./token-rpc.js";

export {
  LAYERZERO_ENDPOINT_V2, STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS, STARGATE_TOKEN_DESTINATION_CHAIN,
  STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_MESSAGING,
  STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN,
  STARGATE_TOKEN_MAX_BRIDGE_GAS, STARGATE_TOKEN_MECHANISM, STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS,
  STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_SOURCE_EXECUTOR,
  STARGATE_TOKEN_SOURCE_MESSAGING, STARGATE_TOKEN_SOURCE_POOL,
  STARGATE_TOKEN_SOURCE_TOKEN, encodeStargateNativeDrop,
} from "./token-codec.js";
export { FileStargateTokenJournal, stargateV2TokenCanonicalReceipt } from "./token-journal.js";
export type * from "./token-model.js";

export async function prepareStargateV2Token(request: StargateTokenPreparationRequest, ports: StargateTokenExecutionPorts,
  journal: StargateTokenJournal): Promise<StargateTokenOperation> {
  const now = ports.now ?? Date.now, profile = canonicalProfile(request.profile), owner = address(request.owner), recipient = address(request.recipient);
  if (owner !== recipient) fail("APN_OPERATION_BLOCKED", "first_lane_requires_self_recipient");
  if (ports.signer.kind !== "imported_evm_signer" || address(ports.signer.address) !== owner) fail("APN_OPERATION_BLOCKED", "signer_owner");
  const amount = uint(request.amountAtomic, true), drop = uint(request.nativeDropAtomic), minOut = uint(request.minOutputAtomic, true), cap = uint(request.maxNativeDebitAtomic, true);
  const hasMaxFee = request.maxFeePerGasWei !== undefined, hasPriorityFee = request.maxPriorityFeePerGasWei !== undefined;
  if (hasMaxFee !== hasPriorityFee) fail("APN_INVALID_INPUT", "fee_ceiling_pair_required");
  const requestedMaxFee = hasMaxFee ? uint(request.maxFeePerGasWei, true) : undefined;
  const requestedPriority = hasPriorityFee ? uint(request.maxPriorityFeePerGasWei, true) : undefined;
  if (requestedMaxFee !== undefined && requestedPriority! > requestedMaxFee) fail("APN_INVALID_INPUT", "priority_fee_ceiling_exceeds_max_fee_ceiling");
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(request.idempotencyKey)) fail("APN_INVALID_INPUT", "idempotency_key");
  const ttl = request.ttlMs ?? 60_000; if (!Number.isSafeInteger(ttl) || ttl < 15_000 || ttl > MAX_TTL_MS) fail("APN_INVALID_INPUT", "ttl");
  const profileHash = hashObject({ profile }), idempotencyHash = hashObject({ idempotencyKey: request.idempotencyKey });
  const operationId = hashObject({ family: "stargate_v2_token", profileHash, idempotencyHash });
  const existing = await journal.load(operationId); if (existing !== null) {
    if (existing.profile !== profile || existing.owner !== owner || existing.recipient !== recipient || existing.amountAtomic !== amount.toString() ||
      existing.nativeDropAtomic !== drop.toString() || existing.minOutputAtomic !== minOut.toString() || existing.maxNativeDebitAtomic !== cap.toString() ||
      (requestedMaxFee !== undefined && (existing.feeApproval?.approvedMaxFeePerGasWei !== requestedMaxFee.toString() || existing.feeApproval.approvedMaxPriorityFeePerGasWei !== requestedPriority!.toString())) ||
      (requestedMaxFee === undefined && existing.feeApproval?.provenance === "owner_ceiling")) fail("APN_OPERATION_BLOCKED", "idempotency_conflict");
    return existing;
  }
  // The owner's claim is written before the quote and every RPC read: any other money operation on this account waits.
  return await journal.admit({ operationId, profile, owner }, async () => {
  const options = drop === 0n ? "0x" as Hex : encodeStargateNativeDrop(drop.toString(), recipient);
  const nativeCap = await readExecutorCap(ports.sourceCall, "latest"); if (drop > nativeCap) fail("APN_OPERATION_BLOCKED", "native_drop_cap_exceeded");
  const quote = await quoteStargateV2Direct({ sourceChainId: 10, destinationChainId: 137, sourceToken: STARGATE_TOKEN_SOURCE_TOKEN,
    destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, recipient, amountAtomic: amount.toString(), extraOptions: options }, ports.sourceCall);
  assertLane(quote); if (quote.quote.amountSentAtomic !== amount.toString()) fail("APN_OPERATION_BLOCKED", "dust_amount_not_supported");
  if (BigInt(quote.quote.minimumOutputAtomic) < minOut) fail("APN_OPERATION_BLOCKED", "minimum_output_not_met");
  const source = await readPoolConfig(ports.sourceCall, 10, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, 30111, "latest");
  const destination = await readPoolConfig(ports.destinationCall, 137, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, 30109, "latest");
  const finalityPolicy = stargateV2RouteFinalityPolicy(STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_DESTINATION_CHAIN);
  const [allowance, tokenBalance, dest] = await Promise.all([readAllowance(ports.sourceCall, owner, "pending"), readTokenBalance(ports.sourceCall, STARGATE_TOKEN_SOURCE_TOKEN, owner, "pending"),
    ports.destinationBalances(recipient, finalityPolicy.destination.blockTag)]);
  if (tokenBalance < amount) fail("APN_OPERATION_BLOCKED", "insufficient_token_balance");
  if (allowance !== 0n && allowance !== amount) fail("APN_OPERATION_BLOCKED", "residual_allowance_cleanup_required");
  const sendParam = { dstEid: 30109, to: pad(recipient, { size: 32 }), amountLD: amount, minAmountLD: BigInt(quote.quote.minimumOutputAtomic),
    extraOptions: options, composeMsg: "0x" as Hex, oftCmd: "0x" as Hex };
  const exactFee = await requoteSend(ports.sourceCall, sendParam, `0x${BigInt(quote.block.numberAtomic).toString(16)}`);
  if (exactFee !== BigInt(quote.quote.nativeMessageFeeAtomic)) fail("APN_REPREPARE_REQUIRED", "exact_send_fee_changed");
  const sendData = encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: "sendToken", args: [sendParam,
    { nativeFee: BigInt(quote.quote.nativeMessageFeeAtomic), lzTokenFee: 0n }, owner] });
  const approvalRequired = allowance === 0n;
  const approvalData = encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "approve", args: [STARGATE_TOKEN_SOURCE_POOL, amount] });
  const approvalPrepared = approvalRequired ? await ports.prepareEnvelope({ chainId: 10, from: owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data: approvalData, valueAtomic: "0" }) : undefined;
  const baseNonce = approvalPrepared?.nonceAtomic;
  const exactSendPrepared = approvalRequired ? undefined : await ports.prepareEnvelope({ chainId: 10, from: owner, to: STARGATE_TOKEN_SOURCE_POOL, data: sendData,
    valueAtomic: quote.quote.nativeMessageFeeAtomic });
  const quotedPrepared = approvalPrepared ?? exactSendPrepared!;
  const quotedMaxFee = uint(quotedPrepared.maxFeePerGasAtomic, true), quotedPriority = uint(quotedPrepared.maxPriorityFeePerGasAtomic);
  if (quotedPriority > quotedMaxFee) fail("APN_RPC_PROTOCOL", "priority_fee");
  const approvedMaxFee = requestedMaxFee ?? quotedMaxFee, approvedPriority = requestedPriority ?? quotedPriority;
  if (approvedMaxFee < quotedMaxFee || approvedPriority < quotedPriority) fail("APN_INVALID_INPUT", "fee_ceiling_below_fresh_quote");
  const feeApproval = { provenance: requestedMaxFee === undefined ? "exact_snapshot" as const : "owner_ceiling" as const,
    quotedMaxFeePerGasWei: quotedMaxFee.toString(), quotedMaxPriorityFeePerGasWei: quotedPriority.toString(),
    approvedMaxFeePerGasWei: approvedMaxFee.toString(), approvedMaxPriorityFeePerGasWei: approvedPriority.toString() };
  const envelope = (to: Address, data: Hex, value: string, p: StargateTokenPreparedEnvelope): StargateTokenEnvelope => ({ chainId: 10, from: owner, to, data,
    valueAtomic: value, nonceAtomic: uint(p.nonceAtomic).toString(), gasLimitAtomic: uint(p.gasLimitAtomic, true).toString(),
    maxFeePerGasAtomic: approvedMaxFee.toString(), maxPriorityFeePerGasAtomic: approvedPriority.toString() });
  const approvalEnvelope = approvalPrepared === undefined ? undefined : envelope(STARGATE_TOKEN_SOURCE_TOKEN, approvalData, "0", approvalPrepared);
  const approvalDebit = approvalEnvelope === undefined ? 0n : BigInt(approvalEnvelope.gasLimitAtomic) * BigInt(approvalEnvelope.maxFeePerGasAtomic);
  const messageValue = BigInt(quote.quote.nativeMessageFeeAtomic);
  if (approvalDebit + messageValue >= cap) fail("APN_OPERATION_BLOCKED", "max_native_debit_exceeded");
  const stagedGasCeiling = approvalRequired ? (cap - approvalDebit - messageValue) / approvedMaxFee : 0n;
  if (approvalRequired && stagedGasCeiling < 1n) fail("APN_OPERATION_BLOCKED", "bridge_gas_budget_empty");
  const boundedStagedGas = stagedGasCeiling > STARGATE_TOKEN_MAX_BRIDGE_GAS ? STARGATE_TOKEN_MAX_BRIDGE_GAS : stagedGasCeiling;
  const sendPrepared = exactSendPrepared ?? { nonceAtomic: (BigInt(baseNonce!) + 1n).toString(), gasLimitAtomic: boundedStagedGas.toString(),
    maxFeePerGasAtomic: approvedMaxFee.toString(), maxPriorityFeePerGasAtomic: approvedPriority.toString(),
    nativeBalanceAtomic: approvalPrepared!.nativeBalanceAtomic };
  const sendEnvelope = envelope(STARGATE_TOKEN_SOURCE_POOL, sendData, quote.quote.nativeMessageFeeAtomic, sendPrepared);
  for (const e of [approvalEnvelope, sendEnvelope].filter((x): x is StargateTokenEnvelope => x !== undefined)) if (BigInt(e.maxPriorityFeePerGasAtomic) > BigInt(e.maxFeePerGasAtomic)) fail("APN_RPC_PROTOCOL", "priority_fee");
  const gasDebit = [approvalEnvelope, sendEnvelope].filter((x): x is StargateTokenEnvelope => x !== undefined)
    .reduce((sum, e) => sum + BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic), 0n);
  const maximumDebit = BigInt(quote.quote.nativeMessageFeeAtomic) + gasDebit;
  if (maximumDebit > cap) fail("APN_OPERATION_BLOCKED", "max_native_debit_exceeded");
  if (BigInt(sendPrepared.nativeBalanceAtomic) < maximumDebit) fail("APN_OPERATION_BLOCKED", "insufficient_native_balance");
  const policy = await ports.admitPolicy({ profile, owner, amountAtomic: amount.toString(), operationId });
  const preparedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + ttl).toISOString();
  const body = { schemaVersion: "apn.stargate-v2-token-operation.v5" as const, operationId, profile, profileHash, idempotencyHash, owner, recipient, finalityPolicy, finalityPolicyProvenance: "pinned_v2" as const,
    amountAtomic: amount.toString(), nativeDropAtomic: drop.toString(), maxNativeDebitAtomic: cap.toString(), minOutputAtomic: minOut.toString(),
    sourceToken: STARGATE_TOKEN_SOURCE_TOKEN, destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, sourcePool: STARGATE_TOKEN_SOURCE_POOL,
    destinationPool: STARGATE_TOKEN_DESTINATION_POOL, sourceEid: 30111 as const, destinationEid: 30109 as const,
    executor: STARGATE_TOKEN_SOURCE_EXECUTOR, executorNativeCapAtomic: nativeCap.toString(), options, quote,
    sourceCodeHash: source.poolCodeHash, destinationCodeHash: destination.poolCodeHash, sourceTokenCodeHash: source.tokenCodeHash,
    destinationTokenCodeHash: destination.tokenCodeHash, policy, destinationTokenBalanceBeforeAtomic: dest.tokenAtomic,
    destinationNativeBalanceBeforeAtomic: dest.nativeAtomic, destinationBalanceBlock: { numberAtomic: dest.blockNumberAtomic, hash: dest.blockHash },
    initialAllowanceAtomic: allowance.toString(), allowanceRequired: approvalRequired, feeApproval, ...(approvalEnvelope === undefined ? {} : { approvalEnvelope }),
    bridgeSimulation: { mode: approvalRequired ? "pending_post_approval" as const : "exact_at_prepare" as const,
      prepareStatus: approvalRequired ? "pending_post_approval" as const : "succeeded" as const, gasCeilingAtomic: sendEnvelope.gasLimitAtomic }, sendEnvelope,
    approvalFinalityWindowMs: STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS,
    maximumDebitAtomic: maximumDebit.toString(), preparedAt, expiresAt, phase: "prepared" as const,
    transitions: [{ phase: "prepared" as const, at: preparedAt, reason: "fresh_quote_caps_allowance_and_envelopes_frozen" }],
  };
  const operation = seal(body); await journal.save(operation); return operation;
  });
}
export async function executeStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  const initial = await journal.load(id); if (initial === null) fail("APN_OPERATION_BLOCKED", "operation_missing");
  return await journal.withOwnerLock(initial.owner, async () =>
    await journal.withLock(id, async () => await executeLocked(id, ports, journal)));
}
/** Network observation only: it may advance an attempted effect and can never sign or broadcast. */
export async function observeStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  return await journal.withLock(id, async () => {
    let op = await journal.load(id); if (op === null) fail("APN_OPERATION_BLOCKED", "operation_missing");
    op = await reconcileUsageOrCleanup(op, ports, journal);
    if (["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted"].includes(op.phase)) {
      return await observeAllowance(op, ports, journal);
    }
    if (["submission_started", "unknown_finality", "submitted"].includes(op.phase)) return await observeBridge(op, ports, journal);
    if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase)) return await observeCleanup(op, ports, journal);
    if (op.phase === "allowance_observed" || op.phase === "post_approval_quote_bound" || op.phase === "observed" || op.phase === "cleaned" || op.phase === "cleanup_required" ||
      op.phase === "abandoned_unknown") return op;
    fail("APN_OPERATION_BLOCKED", "operation_not_attempted");
  });
}
async function executeLocked(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation> {
  let op = await journal.load(id); if (op === null) fail("APN_OPERATION_BLOCKED", "operation_missing"); const now = ports.now ?? Date.now;
  op = await reconcileUsageOrCleanup(op, ports, journal); if (["observed", "cleaned", "cleanup_required", "abandoned_unknown"].includes(op.phase)) return op;
  if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase)) {
    fail("APN_OPERATION_BLOCKED", "cleanup_command_required");
  }
  if (["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted"].includes(op.phase)) {
    op = await observeAllowance(op, ports, journal); if (op.phase !== "allowance_observed") return op;
  }
  if (["submission_started", "unknown_finality", "submitted"].includes(op.phase)) return await observeBridge(op, ports, journal);
  if (Date.parse(op.expiresAt) <= now() &&
    !(op.allowanceRequired && ["allowance_observed", "post_approval_quote_bound"].includes(op.phase))) {
    if (op.phase === "allowance_observed") return await requireCleanup(op, ports, journal, "expired_after_allowance");
    fail("APN_REPREPARE_REQUIRED", "expired");
  }
  if (op.phase === "prepared") { await ports.approve(op); if (Date.parse(op.expiresAt) <= now()) fail("APN_REPREPARE_REQUIRED", "approval_completed_after_prepare_expiry");
    op = transition(op, "approved", "foreground_owner_confirmation", now()); await journal.save(op); }
  if (op.allowanceRequired && op.phase === "approved") {
    await freshPreflight(op, ports, "before_approval"); await ports.confirmPolicy(op);
    const raw = await ports.signer.signTransaction(op.approvalEnvelope!); await verifySignedEnvelope(raw, op.owner, op.approvalEnvelope!);
    const markerAt = now(); if (Date.parse(op.expiresAt) <= markerAt) fail("APN_REPREPARE_REQUIRED", "approval_marker_after_prepare_expiry");
    const approvalFinalityDeadline = new Date(markerAt + (op.approvalFinalityWindowMs ?? 0)).toISOString();
    const hash = keccak256(raw); op = transition({ ...op, approvalTransactionHash: hash,
      approvalSubmissionStartedAt: new Date(markerAt).toISOString(), approvalFinalityDeadline },
      "allowance_submission_started", "approval_attempt_marked_before_send", markerAt); await journal.save(op);
    try { if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase()) fail("APN_RPC_AMBIGUOUS", "approval_hash");
      op = transition(op, "allowance_submitted", "approval_broadcast_returned_exact_hash", now()); await journal.save(op);
    } catch { op = transition(op, "allowance_unknown_finality", "approval_broadcast_ambiguous_no_resend", now()); await journal.save(op); return op; }
    op = await observeAllowance(op, ports, journal); if (op.phase !== "allowance_observed") return op;
  }
  // A quote bound in this invocation already re-proved cap, pools, allowance, balances, exact fee, nonce, fee rule and
  // simulation moments ago under the held locks, so the send does not repeat that preflight (BRDG-32).
  let boundNow = false;
  if (op.allowanceRequired) {
    if (op.approvalFinalityDeadline === undefined || now() >= Date.parse(op.approvalFinalityDeadline))
      return await requireCleanup(op, ports, journal, "approval_finality_deadline_passed", true);
    if (op.phase === "allowance_observed" && op.postApprovalQuote === undefined) { boundNow = true;
      let postApprovalQuote: StargateTokenPostApprovalQuote;
      try {
        postApprovalQuote = await createPostApprovalQuote(op, ports);
      } catch (error) {
        return await requireCleanup(op, ports, journal,
          error instanceof ApnError ? `post_approval_quote_${String(error.details?.reason ?? error.code)}` : "post_approval_quote_unavailable");
      }
      op = transition({ ...op, postApprovalQuote }, "post_approval_quote_bound", "fresh_post_approval_quote_bound", now()); await journal.save(op);
    }
    if (op.postApprovalQuote === undefined || op.phase !== "post_approval_quote_bound") fail("APN_STATE_CORRUPT", "post_approval_quote_missing");
    if (now() >= Date.parse(op.postApprovalQuote.expiresAt)) return await requireCleanup(op, ports, journal, "post_approval_quote_expired");
  }
  try {
    if (!boundNow) await freshPreflight(op, ports, "before_send"); else await sendFeeAdmitted(op, ports); await ports.confirmPolicy(op);
    // The signer re-checks profile and address under its custody lock while signing (BRDG-37); only its port is checked here.
    if (address(ports.signer.address) !== op.owner) fail("APN_REPREPARE_REQUIRED", "signer_identity_changed");
  } catch (error) { return await requireCleanup(op, ports, journal, error instanceof ApnError ? String(error.details?.reason ?? error.code) : "bridge_preflight_failed"); }
  op = await markUsageTarget(op, "reserved", journal);
  try { op = await reconcileUsage(op, ports, journal); }
  catch (error) {
    op = await requireCleanup(op, ports, journal, error instanceof ApnError ? `usage_reservation_${String(error.code).toLowerCase()}` : "usage_reservation_failed");
    op = await markUsageTarget(op, "failed_before_effect", journal); try { op = await reconcileUsage(op, ports, journal); } catch { /* durable target retries */ }
    return op;
  }
  let raw: Hex;
  const bridgeEnvelope = op.postApprovalQuote?.sendEnvelope ?? op.sendEnvelope;
  try { raw = await ports.signer.signTransaction(bridgeEnvelope); await verifySignedEnvelope(raw, op.owner, bridgeEnvelope);
    if (op.postApprovalQuote !== undefined && now() >= Date.parse(op.postApprovalQuote.expiresAt)) fail("APN_REPREPARE_REQUIRED", "post_approval_quote_expired_before_marker"); }
  catch (error) { op = await requireCleanup(op, ports, journal, "bridge_signing_failed"); op = await markUsageTarget(op, "failed_before_effect", journal);
    try { await reconcileUsage(op, ports, journal); } catch { /* durable target retries */ } throw error; }
  const hash = keccak256(raw);
  op = transition({ ...op, transactionHash: hash }, "submission_started", "bridge_attempt_marked_before_send", now()); await journal.save(op);
  try { if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase()) fail("APN_RPC_AMBIGUOUS", "send_hash"); }
  catch { op = transition(op, "unknown_finality", "bridge_broadcast_ambiguous_no_resend", now()); await journal.save(op); op = await markUsageTarget(op, "unknown_finality", journal);
    try { op = await reconcileUsage(op, ports, journal); } catch { /* durable target retries */ } return op; }
  op = transition(op, "submitted", "bridge_broadcast_returned_exact_hash", now()); await journal.save(op); op = await markUsageTarget(op, "submitted", journal); op = await reconcileUsage(op, ports, journal);
  return await observeBridge(op, ports, journal, true);
}
async function observeAllowance(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  if (op.approvalTransactionHash === undefined) fail("APN_STATE_CORRUPT", "approval_hash_missing"); const receipt = await ports.waitSourceReceipt(op.approvalTransactionHash, op.finalityPolicy.source.blockTag);
  const now = (ports.now ?? Date.now)();
  if (receipt === null) {
    if (op.approvalFinalityDeadline === undefined || now >= Date.parse(op.approvalFinalityDeadline))
      return await requireCleanup(op, ports, journal, "approval_finality_deadline_passed", true);
    if (op.phase !== "allowance_unknown_finality") { op = transition(op, "allowance_unknown_finality", "approval_receipt_not_safe", now); await journal.save(op); } return op;
  }
  if (receipt.finality !== op.finalityPolicy.source.blockTag || receipt.transactionHash !== op.approvalTransactionHash)
    return await requireCleanup(op, ports, journal, "approval_receipt_mismatched", true);
  if (receipt.status !== "success") return await requireCleanup(op, ports, journal, "approval_confirmed_revert", false);
  if (op.approvalFinalityDeadline === undefined || now >= Date.parse(op.approvalFinalityDeadline))
    return await requireCleanup(op, ports, journal, "approval_safe_after_finality_deadline", true);
  const allowance = await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag); if (allowance !== BigInt(op.amountAtomic)) fail("APN_RPC_PROTOCOL", "approval_allowance_not_exact");
  op = transition(op, "allowance_observed", "exact_allowance_safe", now); await journal.save(op); return op;
}
/** `sentNow`: the send left in this invocation, so its nonce cannot be finalized past yet and no never-lands read is spent. */
async function observeBridge(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal, sentNow = false) {
  if (op.transactionHash === undefined) fail("APN_STATE_CORRUPT", "bridge_hash_missing");
  // P2: a source receipt already proven at safe finality, and the residual allowance read with it, are not re-read per poll.
  if (op.phase === "submitted" && op.sourceReceipt !== undefined && op.residualAllowanceAtomic !== undefined)
    return await observeDelivery(op, ports, journal, op.sourceReceipt, BigInt(op.residualAllowanceAtomic));
  const receipt = await ports.waitSourceReceipt(op.transactionHash, op.finalityPolicy.source.blockTag);
  if (receipt === null) { if (op.phase !== "unknown_finality") { op = transition(op, "unknown_finality", "source_receipt_not_safe", (ports.now ?? Date.now)()); await journal.save(op); }
    op = await markUsageTarget(op, "unknown_finality", journal); op = await reconcileUsage(op, ports, journal);
    return sentNow ? op : await retireSendIfNeverLanded(op, ports, journal); }
  if (receipt.status === "reverted") { if (receipt.transactionHash !== op.transactionHash || receipt.finality !== op.finalityPolicy.source.blockTag) fail("APN_RPC_PROTOCOL", "source_revert_receipt");
    op = await requireCleanup(op, ports, journal, "bridge_confirmed_revert"); op = await markUsageTarget(op, "failed_confirmed_revert", journal); return await reconcileUsage(op, ports, journal); }
  return await observeDelivery(op, ports, journal, sourceReceipt(op, receipt), await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag));
}
async function observeDelivery(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal,
  source: StargateTokenSourceReceipt, residual: bigint) {
  const destinationBaseline = op.postApprovalQuote?.destinationSnapshot ?? {
    tokenBalanceAtomic: op.destinationTokenBalanceBeforeAtomic, nativeBalanceAtomic: op.destinationNativeBalanceBeforeAtomic,
    blockNumberAtomic: op.destinationBalanceBlock.numberAtomic, blockHash: op.destinationBalanceBlock.hash };
  const destination = await ports.observeDestination({ sourceTransactionHash: source.transactionHash, guid: source.guid, recipient: op.recipient,
    sourceEid: 30111, destinationPool: STARGATE_TOKEN_DESTINATION_POOL, minimumAmountAtomic: source.amountReceivedAtomic,
    tokenBalanceBeforeAtomic: destinationBaseline.tokenBalanceAtomic, nativeBalanceBeforeAtomic: destinationBaseline.nativeBalanceAtomic,
    nativeDropAtomic: op.nativeDropAtomic, fromBlockNumberAtomic: destinationBaseline.blockNumberAtomic, fromBlockHash: destinationBaseline.blockHash,
    ...(source.packet === undefined ? {} : { sourcePacket: source.packet }),
    finalityTag: op.finalityPolicy.destination.blockTag });
  if (destination === null) { if (op.sourceReceipt === undefined || op.residualAllowanceAtomic === undefined) {
    const evidence = { ...op, sourceReceipt: source, residualAllowanceAtomic: residual.toString() };
    op = op.phase === "submitted" ? seal(evidence) : transition(evidence, "submitted", "source_safe_destination_pending", (ports.now ?? Date.now)());
    await journal.save(op); } op = await markUsageTarget(op, "submitted", journal); return await reconcileUsage(op, ports, journal); }
  validateDestination(op, source, destination);
  if (residual !== 0n) return await requireCleanup({ ...op, sourceReceipt: source, destinationEvidence: destination } as StargateTokenOperation,
    ports, journal, "residual_allowance_after_delivery");
  op = transition({ ...op, sourceReceipt: source, residualAllowanceAtomic: "0", destinationEvidence: destination }, "observed", "destination_token_and_native_drop_safe", (ports.now ?? Date.now)());
  await journal.save(op); op = await markUsageTarget(op, "finalized", journal); return await reconcileUsage(op, ports, journal);
}
async function requireCleanup(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal, reason: string,
  forceApprovalZero = false) {
  const residual = await readAllowance(ports.sourceCall, op.owner, "pending");
  if (residual !== 0n && residual !== BigInt(op.amountAtomic)) fail("APN_OPERATION_BLOCKED", "unexpected_residual_allowance");
  op = transition({ ...op, residualAllowanceAtomic: residual.toString(), cleanupReason: reason }, "cleanup_required",
    residual === 0n ? "cleanup_not_needed_allowance_already_zero" : "explicit_cleanup_required", (ports.now ?? Date.now)());
  await journal.save(op);
  if (residual === 0n && !forceApprovalZero) {
    op = await finishCleanup(op, ports, journal, "zero_residual_allowance_proven");
  }
  return op;
}
/** Explicit foreground cleanup. Observation remains separate and never invokes this signer path. */
export async function cleanupStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  const initial = await journal.load(id); if (initial === null) fail("APN_OPERATION_BLOCKED", "operation_missing");
  return await journal.withOwnerLock(initial.owner, async () => await journal.withLock(id, async () => {
    let op = await journal.load(id); if (op === null) fail("APN_OPERATION_BLOCKED", "operation_missing"); op = await reconcileUsageOrCleanup(op, ports, journal);
    if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase)) return await observeCleanup(op, ports, journal);
    if (op.phase === "cleaned" || op.phase === "observed" || op.phase === "abandoned_unknown") return op;
    if (op.phase !== "cleanup_required") fail("APN_OPERATION_BLOCKED", "cleanup_not_required");
    const allowance = await readAllowance(ports.sourceCall, op.owner, "pending");
    const forceApprovalZero = op.cleanupReason === "approval_finality_deadline_passed" || op.cleanupReason === "approval_safe_after_finality_deadline" || op.cleanupReason === "approval_receipt_mismatched";
    if (allowance === 0n && !forceApprovalZero) return await finishCleanup({ ...op, residualAllowanceAtomic: "0" } as StargateTokenOperation, ports, journal, "zero_residual_allowance_proven");
    if (allowance !== 0n && allowance !== BigInt(op.amountAtomic)) fail("APN_OPERATION_BLOCKED", "unexpected_residual_allowance");
    const data = encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "approve", args: [STARGATE_TOKEN_SOURCE_POOL, 0n] });
    const prepared = await ports.prepareEnvelope({ chainId: 10, from: op.owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data, valueAtomic: "0" });
    const cleanupEnvelope: StargateTokenEnvelope = { chainId: 10, from: op.owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data, valueAtomic: "0",
      nonceAtomic: uint(prepared.nonceAtomic).toString(), gasLimitAtomic: uint(prepared.gasLimitAtomic, true).toString(),
      maxFeePerGasAtomic: uint(prepared.maxFeePerGasAtomic, true).toString(), maxPriorityFeePerGasAtomic: uint(prepared.maxPriorityFeePerGasAtomic).toString() };
    const tx = { from: op.owner, to: cleanupEnvelope.to, data, value: "0x0", gas: `0x${BigInt(cleanupEnvelope.gasLimitAtomic).toString(16)}`,
      maxFeePerGas: `0x${BigInt(cleanupEnvelope.maxFeePerGasAtomic).toString(16)}`, maxPriorityFeePerGas: `0x${BigInt(cleanupEnvelope.maxPriorityFeePerGasAtomic).toString(16)}` };
    const simulation = await ports.sourceCall("eth_call", [tx, "pending"]);
    if (decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "approve", data: simulation as Hex }) !== true) fail("APN_REPREPARE_REQUIRED", "cleanup_simulation");
    const identity = await ports.signerIdentity(); if (canonicalProfile(identity.profile) !== op.profile || address(identity.address) !== op.owner) fail("APN_REPREPARE_REQUIRED", "signer_identity_changed");
    op = seal({ ...op, cleanupEnvelope }); await journal.save(op); await ports.approveCleanup(op);
    const raw = await ports.signer.signTransaction(cleanupEnvelope); await verifySignedEnvelope(raw, op.owner, cleanupEnvelope); const hash = keccak256(raw);
    op = transition({ ...op, cleanupTransactionHash: hash }, "cleanup_submission_started", "cleanup_attempt_marked_before_send", (ports.now ?? Date.now)()); await journal.save(op);
    try { if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase()) fail("APN_RPC_AMBIGUOUS", "cleanup_hash");
      op = transition(op, "cleanup_submitted", "cleanup_broadcast_returned_exact_hash", (ports.now ?? Date.now)()); await journal.save(op);
    } catch { op = transition(op, "cleanup_unknown_finality", "cleanup_broadcast_ambiguous_no_resend", (ports.now ?? Date.now)()); await journal.save(op); return op; }
    return await observeCleanup(op, ports, journal, true);
  }));
}
async function observeCleanup(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal, sentNow = false) {
  if (op.cleanupTransactionHash === undefined) fail("APN_STATE_CORRUPT", "cleanup_hash_missing");
  const receipt = await ports.waitSourceReceipt(op.cleanupTransactionHash, op.finalityPolicy.source.blockTag);
  if (receipt === null) { if (op.phase !== "cleanup_unknown_finality") { op = transition(op, "cleanup_unknown_finality", "cleanup_receipt_not_safe", (ports.now ?? Date.now)()); await journal.save(op); }
    return sentNow ? op : await rearmCleanupIfNeverLanded(op, ports, journal); }
  if (receipt.finality !== op.finalityPolicy.source.blockTag || receipt.transactionHash !== op.cleanupTransactionHash) fail("APN_OPERATION_BLOCKED", "cleanup_failed_or_mismatched");
  // A cleanup that landed without zeroing the allowance is retired; the next one needs fresh owner consent (R4).
  if (receipt.status !== "success") return await rearmCleanup(op, journal, "reverted", null, (ports.now ?? Date.now)());
  if (await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag) !== 0n) return await rearmCleanup(op, journal, "landed_allowance_nonzero", null, (ports.now ?? Date.now)());
  return await finishCleanup({ ...op, residualAllowanceAtomic: "0" } as StargateTokenOperation, ports, journal, "cleanup_safe_zero_allowance");
}
/**
 * R4 exit 2 for the bridge send: the finalized nonce passed it and the node knows neither its transaction nor a receipt.
 * Its hold is released as unsubmitted, and the allowance it would have spent goes to cleanup (closed at once when zero).
 */
async function retireSendIfNeverLanded(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  if (ports.neverLands === undefined || op.transactionHash === undefined || op.usageState !== "unknown_finality" || op.usageTarget !== undefined) return op;
  const nonceAtomic = (op.postApprovalQuote?.sendEnvelope ?? op.sendEnvelope).nonceAtomic;
  const check = await ports.neverLands({ transactionHash: op.transactionHash, nonceAtomic }); if (!check.neverLands) return op;
  op = seal({ ...op, retiredEffects: [...op.retiredEffects ?? [], { role: "bridge", transactionHash: op.transactionHash, nonceAtomic, reason: "never_landed",
    finalizedNonceAtomic: check.finalizedNonce.toString(), at: new Date((ports.now ?? Date.now)()).toISOString() }] }); await journal.save(op);
  op = await markUsageTarget(op, "released_unsubmitted", journal); op = await reconcileUsage(op, ports, journal);
  return await requireCleanup(op, ports, journal, "bridge_never_landed");
}
async function rearmCleanupIfNeverLanded(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  if (ports.neverLands === undefined || op.cleanupTransactionHash === undefined || op.cleanupEnvelope === undefined) return op;
  const check = await ports.neverLands({ transactionHash: op.cleanupTransactionHash, nonceAtomic: op.cleanupEnvelope.nonceAtomic });
  return check.neverLands ? await rearmCleanup(op, journal, "never_landed", check.finalizedNonce.toString(), (ports.now ?? Date.now)()) : op;
}
/** The cleanup slot is freed: the retired cleanup is kept, and `stargate token cleanup` freezes and consents a new one. */
async function rearmCleanup(op: StargateTokenOperation, journal: StargateTokenJournal, reason: "never_landed" | "reverted" | "landed_allowance_nonzero",
  finalizedNonceAtomic: string | null, at: number) {
  const { cleanupEnvelope, cleanupTransactionHash, ...rest } = op;
  op = transition({ ...rest, retiredEffects: [...op.retiredEffects ?? [], { role: "cleanup" as const, transactionHash: cleanupTransactionHash!,
    nonceAtomic: cleanupEnvelope!.nonceAtomic, reason, finalizedNonceAtomic, at: new Date(at).toISOString() }] }, "cleanup_required", `cleanup_${reason}_rearmed`, at);
  await journal.save(op); return op;
}
async function finishCleanup(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal, reason: string) {
  const delivered = op.sourceReceipt !== undefined && op.destinationEvidence !== undefined;
  op = transition(op, delivered ? "observed" : "cleaned", reason, (ports.now ?? Date.now)()); await journal.save(op);
  if (delivered) { op = await markUsageTarget(op, "finalized", journal); op = await reconcileUsage(op, ports, journal); }
  return op;
}
async function markUsageTarget(op: StargateTokenOperation, target: StargateTokenUsageState, journal: StargateTokenJournal) {
  op = seal({ ...op, usageTarget: target }); await journal.save(op); return op;
}
async function reconcileUsage(op: StargateTokenOperation, ports: Pick<StargateTokenExecutionPorts, "reserveUsage" | "followUsage">, journal: StargateTokenJournal) {
  if (op.usageTarget === undefined) return op;
  const state = op.usageTarget === "reserved" ? await ports.reserveUsage(op) : await ports.followUsage(op, op.usageTarget);
  const { usageTarget: _target, ...settled } = op; op = seal({ ...settled, usageState: state }); await journal.save(op); return op;
}
async function reconcileUsageOrCleanup(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  try { return await reconcileUsage(op, ports, journal); }
  catch (error) {
    if (op.usageTarget !== "reserved") throw error;
    op = await requireCleanup(op, ports, journal, error instanceof ApnError ? `usage_reservation_${String(error.code).toLowerCase()}` : "usage_reservation_failed");
    op = await markUsageTarget(op, "failed_before_effect", journal); try { return await reconcileUsage(op, ports, journal); } catch { return op; }
  }
}
/** Local ledger reconciliation for status/recovery callers; this never signs, broadcasts, or performs RPC. */
export async function reconcileStargateV2TokenUsage(id: string, ports: Pick<StargateTokenExecutionPorts, "reserveUsage" | "followUsage">,
  journal: StargateTokenJournal) { return await journal.withLock(id, async () => { const op = await journal.load(id);
    if (op === null) fail("APN_OPERATION_BLOCKED", "operation_missing"); return await reconcileUsage(op, ports, journal); }); }
