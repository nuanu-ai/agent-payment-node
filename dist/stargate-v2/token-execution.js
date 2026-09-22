import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, keccak256, pad } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { canonicalProfile } from "../wallet-policy.js";
import { STARGATE_ERC20_ABI, STARGATE_SEND_ABI } from "./abi.js";
import { assertStargateV2RouteFinalityPolicy, stargateV2RouteFinalityPolicy } from "./finality-policy.js";
import { quoteStargateV2Direct } from "./quote.js";
import { LAYERZERO_ENDPOINT_V2, MAX_TTL_MS, STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS, STARGATE_TOKEN_DESTINATION_CHAIN, STARGATE_TOKEN_DESTINATION_EID, STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_MESSAGING, STARGATE_TOKEN_DESTINATION_MESSAGING_CODE_HASH, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_MAX_BRIDGE_GAS, STARGATE_TOKEN_MECHANISM, STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS, STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_SOURCE_EID, STARGATE_TOKEN_SOURCE_EXECUTOR, STARGATE_TOKEN_SOURCE_MESSAGING, STARGATE_TOKEN_SOURCE_MESSAGING_CODE_HASH, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, address, encodeStargateNativeDrop, fail, hex32, quantity, uint, } from "./token-codec.js";
import { seal, transition } from "./token-journal.js";
import { assertLane, readAllowance, readExecutorCap, readPoolConfig, readTokenBalance, requoteSend, rpcEnvelope, sourceReceipt, validateDestination, verifySignedEnvelope, } from "./token-rpc.js";
export { LAYERZERO_ENDPOINT_V2, STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS, STARGATE_TOKEN_DESTINATION_CHAIN, STARGATE_TOKEN_DESTINATION_EID, STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_MESSAGING, STARGATE_TOKEN_DESTINATION_MESSAGING_CODE_HASH, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_MAX_BRIDGE_GAS, STARGATE_TOKEN_MECHANISM, STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS, STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_SOURCE_EID, STARGATE_TOKEN_SOURCE_EXECUTOR, STARGATE_TOKEN_SOURCE_MESSAGING, STARGATE_TOKEN_SOURCE_MESSAGING_CODE_HASH, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, encodeStargateNativeDrop, } from "./token-codec.js";
export { FileStargateTokenJournal, stargateV2TokenCanonicalReceipt } from "./token-journal.js";
export async function prepareStargateV2Token(request, ports, journal) {
    const now = ports.now ?? Date.now, profile = canonicalProfile(request.profile), owner = address(request.owner), recipient = address(request.recipient);
    if (owner !== recipient)
        fail("APN_OPERATION_BLOCKED", "first_lane_requires_self_recipient");
    if (ports.signer.kind !== "imported_evm_signer" || address(ports.signer.address) !== owner)
        fail("APN_OPERATION_BLOCKED", "signer_owner");
    const amount = uint(request.amountAtomic, true), drop = uint(request.nativeDropAtomic), minOut = uint(request.minOutputAtomic, true), cap = uint(request.maxNativeDebitAtomic, true);
    const hasMaxFee = request.maxFeePerGasWei !== undefined, hasPriorityFee = request.maxPriorityFeePerGasWei !== undefined;
    if (hasMaxFee !== hasPriorityFee)
        fail("APN_INVALID_INPUT", "fee_ceiling_pair_required");
    const requestedMaxFee = hasMaxFee ? uint(request.maxFeePerGasWei, true) : undefined;
    const requestedPriority = hasPriorityFee ? uint(request.maxPriorityFeePerGasWei, true) : undefined;
    if (requestedMaxFee !== undefined && requestedPriority > requestedMaxFee)
        fail("APN_INVALID_INPUT", "priority_fee_ceiling_exceeds_max_fee_ceiling");
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(request.idempotencyKey))
        fail("APN_INVALID_INPUT", "idempotency_key");
    const ttl = request.ttlMs ?? 60_000;
    if (!Number.isSafeInteger(ttl) || ttl < 15_000 || ttl > MAX_TTL_MS)
        fail("APN_INVALID_INPUT", "ttl");
    const profileHash = hashObject({ profile }), idempotencyHash = hashObject({ idempotencyKey: request.idempotencyKey });
    const operationId = hashObject({ family: "stargate_v2_token", profileHash, idempotencyHash });
    const existing = await journal.load(operationId);
    if (existing !== null) {
        if (existing.profile !== profile || existing.owner !== owner || existing.recipient !== recipient || existing.amountAtomic !== amount.toString() ||
            existing.nativeDropAtomic !== drop.toString() || existing.minOutputAtomic !== minOut.toString() || existing.maxNativeDebitAtomic !== cap.toString() ||
            (requestedMaxFee !== undefined && (existing.feeApproval?.approvedMaxFeePerGasWei !== requestedMaxFee.toString() || existing.feeApproval.approvedMaxPriorityFeePerGasWei !== requestedPriority.toString())) ||
            (requestedMaxFee === undefined && existing.feeApproval?.provenance === "owner_ceiling"))
            fail("APN_OPERATION_BLOCKED", "idempotency_conflict");
        return existing;
    }
    const options = drop === 0n ? "0x" : encodeStargateNativeDrop(drop.toString(), recipient);
    const nativeCap = await readExecutorCap(ports.sourceCall, "latest");
    if (drop > nativeCap)
        fail("APN_OPERATION_BLOCKED", "native_drop_cap_exceeded");
    const quote = await quoteStargateV2Direct({ sourceChainId: 10, destinationChainId: 137, sourceToken: STARGATE_TOKEN_SOURCE_TOKEN,
        destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, recipient, amountAtomic: amount.toString(), extraOptions: options }, ports.sourceCall);
    assertLane(quote);
    if (quote.quote.amountSentAtomic !== amount.toString())
        fail("APN_OPERATION_BLOCKED", "dust_amount_not_supported");
    if (BigInt(quote.quote.minimumOutputAtomic) < minOut)
        fail("APN_OPERATION_BLOCKED", "minimum_output_not_met");
    const source = await readPoolConfig(ports.sourceCall, 10, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, 30111, "latest");
    const destination = await readPoolConfig(ports.destinationCall, 137, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, 30109, "latest");
    const finalityPolicy = stargateV2RouteFinalityPolicy(STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_DESTINATION_CHAIN);
    const [allowance, tokenBalance, dest] = await Promise.all([readAllowance(ports.sourceCall, owner, "pending"), readTokenBalance(ports.sourceCall, STARGATE_TOKEN_SOURCE_TOKEN, owner, "pending"),
        ports.destinationBalances(recipient, finalityPolicy.destination.blockTag)]);
    if (tokenBalance < amount)
        fail("APN_OPERATION_BLOCKED", "insufficient_token_balance");
    if (allowance !== 0n && allowance !== amount)
        fail("APN_OPERATION_BLOCKED", "residual_allowance_cleanup_required");
    const sendParam = { dstEid: 30109, to: pad(recipient, { size: 32 }), amountLD: amount, minAmountLD: BigInt(quote.quote.minimumOutputAtomic),
        extraOptions: options, composeMsg: "0x", oftCmd: "0x" };
    const exactFee = await requoteSend(ports.sourceCall, sendParam, `0x${BigInt(quote.block.numberAtomic).toString(16)}`);
    if (exactFee !== BigInt(quote.quote.nativeMessageFeeAtomic))
        fail("APN_REPREPARE_REQUIRED", "exact_send_fee_changed");
    const sendData = encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: "sendToken", args: [sendParam,
            { nativeFee: BigInt(quote.quote.nativeMessageFeeAtomic), lzTokenFee: 0n }, owner] });
    const approvalRequired = allowance === 0n;
    const approvalData = encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "approve", args: [STARGATE_TOKEN_SOURCE_POOL, amount] });
    const approvalPrepared = approvalRequired ? await ports.prepareEnvelope({ chainId: 10, from: owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data: approvalData, valueAtomic: "0" }) : undefined;
    const baseNonce = approvalPrepared?.nonceAtomic;
    const exactSendPrepared = approvalRequired ? undefined : await ports.prepareEnvelope({ chainId: 10, from: owner, to: STARGATE_TOKEN_SOURCE_POOL, data: sendData,
        valueAtomic: quote.quote.nativeMessageFeeAtomic });
    const quotedPrepared = approvalPrepared ?? exactSendPrepared;
    const quotedMaxFee = uint(quotedPrepared.maxFeePerGasAtomic, true), quotedPriority = uint(quotedPrepared.maxPriorityFeePerGasAtomic);
    if (quotedPriority > quotedMaxFee)
        fail("APN_RPC_PROTOCOL", "priority_fee");
    const approvedMaxFee = requestedMaxFee ?? quotedMaxFee, approvedPriority = requestedPriority ?? quotedPriority;
    if (approvedMaxFee < quotedMaxFee || approvedPriority < quotedPriority)
        fail("APN_INVALID_INPUT", "fee_ceiling_below_fresh_quote");
    const feeApproval = { provenance: requestedMaxFee === undefined ? "exact_snapshot" : "owner_ceiling",
        quotedMaxFeePerGasWei: quotedMaxFee.toString(), quotedMaxPriorityFeePerGasWei: quotedPriority.toString(),
        approvedMaxFeePerGasWei: approvedMaxFee.toString(), approvedMaxPriorityFeePerGasWei: approvedPriority.toString() };
    const envelope = (to, data, value, p) => ({ chainId: 10, from: owner, to, data,
        valueAtomic: value, nonceAtomic: uint(p.nonceAtomic).toString(), gasLimitAtomic: uint(p.gasLimitAtomic, true).toString(),
        maxFeePerGasAtomic: approvedMaxFee.toString(), maxPriorityFeePerGasAtomic: approvedPriority.toString() });
    const approvalEnvelope = approvalPrepared === undefined ? undefined : envelope(STARGATE_TOKEN_SOURCE_TOKEN, approvalData, "0", approvalPrepared);
    const approvalDebit = approvalEnvelope === undefined ? 0n : BigInt(approvalEnvelope.gasLimitAtomic) * BigInt(approvalEnvelope.maxFeePerGasAtomic);
    const messageValue = BigInt(quote.quote.nativeMessageFeeAtomic);
    if (approvalDebit + messageValue >= cap)
        fail("APN_OPERATION_BLOCKED", "max_native_debit_exceeded");
    const stagedGasCeiling = approvalRequired ? (cap - approvalDebit - messageValue) / approvedMaxFee : 0n;
    if (approvalRequired && stagedGasCeiling < 1n)
        fail("APN_OPERATION_BLOCKED", "bridge_gas_budget_empty");
    const boundedStagedGas = stagedGasCeiling > STARGATE_TOKEN_MAX_BRIDGE_GAS ? STARGATE_TOKEN_MAX_BRIDGE_GAS : stagedGasCeiling;
    const sendPrepared = exactSendPrepared ?? { nonceAtomic: (BigInt(baseNonce) + 1n).toString(), gasLimitAtomic: boundedStagedGas.toString(),
        maxFeePerGasAtomic: approvedMaxFee.toString(), maxPriorityFeePerGasAtomic: approvedPriority.toString(),
        nativeBalanceAtomic: approvalPrepared.nativeBalanceAtomic };
    const sendEnvelope = envelope(STARGATE_TOKEN_SOURCE_POOL, sendData, quote.quote.nativeMessageFeeAtomic, sendPrepared);
    for (const e of [approvalEnvelope, sendEnvelope].filter((x) => x !== undefined))
        if (BigInt(e.maxPriorityFeePerGasAtomic) > BigInt(e.maxFeePerGasAtomic))
            fail("APN_RPC_PROTOCOL", "priority_fee");
    const gasDebit = [approvalEnvelope, sendEnvelope].filter((x) => x !== undefined)
        .reduce((sum, e) => sum + BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic), 0n);
    const maximumDebit = BigInt(quote.quote.nativeMessageFeeAtomic) + gasDebit;
    if (maximumDebit > cap)
        fail("APN_OPERATION_BLOCKED", "max_native_debit_exceeded");
    if (BigInt(sendPrepared.nativeBalanceAtomic) < maximumDebit)
        fail("APN_OPERATION_BLOCKED", "insufficient_native_balance");
    const policy = await ports.admitPolicy({ profile, owner, amountAtomic: amount.toString(), operationId });
    const preparedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + ttl).toISOString();
    const body = { schemaVersion: "apn.stargate-v2-token-operation.v5", operationId, profile, profileHash, idempotencyHash, owner, recipient, finalityPolicy, finalityPolicyProvenance: "pinned_v2",
        amountAtomic: amount.toString(), nativeDropAtomic: drop.toString(), maxNativeDebitAtomic: cap.toString(), minOutputAtomic: minOut.toString(),
        sourceToken: STARGATE_TOKEN_SOURCE_TOKEN, destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, sourcePool: STARGATE_TOKEN_SOURCE_POOL,
        destinationPool: STARGATE_TOKEN_DESTINATION_POOL, sourceEid: 30111, destinationEid: 30109,
        executor: STARGATE_TOKEN_SOURCE_EXECUTOR, executorNativeCapAtomic: nativeCap.toString(), options, quote,
        sourceCodeHash: source.poolCodeHash, destinationCodeHash: destination.poolCodeHash, sourceTokenCodeHash: source.tokenCodeHash,
        destinationTokenCodeHash: destination.tokenCodeHash, policy, destinationTokenBalanceBeforeAtomic: dest.tokenAtomic,
        destinationNativeBalanceBeforeAtomic: dest.nativeAtomic, destinationBalanceBlock: { numberAtomic: dest.blockNumberAtomic, hash: dest.blockHash },
        initialAllowanceAtomic: allowance.toString(), allowanceRequired: approvalRequired, feeApproval, ...(approvalEnvelope === undefined ? {} : { approvalEnvelope }),
        bridgeSimulation: { mode: approvalRequired ? "pending_post_approval" : "exact_at_prepare",
            prepareStatus: approvalRequired ? "pending_post_approval" : "succeeded", gasCeilingAtomic: sendEnvelope.gasLimitAtomic }, sendEnvelope,
        approvalFinalityWindowMs: STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS,
        maximumDebitAtomic: maximumDebit.toString(), preparedAt, expiresAt, phase: "prepared",
        transitions: [{ phase: "prepared", at: preparedAt, reason: "fresh_quote_caps_allowance_and_envelopes_frozen" }],
    };
    const operation = seal(body);
    await journal.save(operation);
    return operation;
}
export async function executeStargateV2Token(id, ports, journal) {
    const initial = await journal.load(id);
    if (initial === null)
        fail("APN_OPERATION_BLOCKED", "operation_missing");
    return await journal.withOwnerChainLock(initial.owner, 10, async () => await journal.withLock(id, async () => await executeLocked(id, ports, journal)));
}
/** Network observation only: it may advance an attempted effect and can never sign or broadcast. */
export async function observeStargateV2Token(id, ports, journal) {
    return await journal.withLock(id, async () => {
        let op = await journal.load(id);
        if (op === null)
            fail("APN_OPERATION_BLOCKED", "operation_missing");
        op = await reconcileUsageOrCleanup(op, ports, journal);
        if (["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted"].includes(op.phase)) {
            return await observeAllowance(op, ports, journal);
        }
        if (["submission_started", "unknown_finality", "submitted"].includes(op.phase))
            return await observeBridge(op, ports, journal);
        if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase))
            return await observeCleanup(op, ports, journal);
        if (op.phase === "allowance_observed" || op.phase === "post_approval_quote_bound" || op.phase === "observed" || op.phase === "cleaned" || op.phase === "cleanup_required")
            return op;
        fail("APN_OPERATION_BLOCKED", "operation_not_attempted");
    });
}
async function executeLocked(id, ports, journal) {
    let op = await journal.load(id);
    if (op === null)
        fail("APN_OPERATION_BLOCKED", "operation_missing");
    const now = ports.now ?? Date.now;
    if (op.finalityPolicyProvenance === "derived_legacy_v1") {
        if (["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted"].includes(op.phase))
            return await observeAllowance(op, ports, journal);
        if (["submission_started", "unknown_finality", "submitted"].includes(op.phase))
            return await observeBridge(op, ports, journal);
        if (op.phase === "observed" || op.phase === "cleaned" || op.phase === "cleanup_required")
            return op;
        fail("APN_OPERATION_BLOCKED", "legacy_operation_nonresumable");
    }
    op = await reconcileUsageOrCleanup(op, ports, journal);
    if (op.phase === "observed" || op.phase === "cleaned" || op.phase === "cleanup_required")
        return op;
    if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase)) {
        fail("APN_OPERATION_BLOCKED", "cleanup_command_required");
    }
    if (["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted"].includes(op.phase)) {
        op = await observeAllowance(op, ports, journal);
        if (op.phase !== "allowance_observed")
            return op;
    }
    if (["submission_started", "unknown_finality", "submitted"].includes(op.phase))
        return await observeBridge(op, ports, journal);
    if (Date.parse(op.expiresAt) <= now() && !(op.schemaVersion === "apn.stargate-v2-token-operation.v5" &&
        op.allowanceRequired && ["allowance_observed", "post_approval_quote_bound"].includes(op.phase))) {
        if (op.phase === "allowance_observed")
            return await requireCleanup(op, ports, journal, "expired_after_allowance");
        fail("APN_REPREPARE_REQUIRED", "expired");
    }
    if (op.phase === "prepared") {
        await ports.approve(op);
        if (Date.parse(op.expiresAt) <= now())
            fail("APN_REPREPARE_REQUIRED", "approval_completed_after_prepare_expiry");
        op = transition(op, "approved", "foreground_owner_confirmation", now());
        await journal.save(op);
    }
    if (op.allowanceRequired && op.phase === "approved") {
        await freshPreflight(op, ports, "before_approval");
        await ports.confirmPolicy(op);
        const raw = await ports.signer.signTransaction(op.approvalEnvelope);
        await verifySignedEnvelope(raw, op.owner, op.approvalEnvelope);
        const markerAt = now();
        if (Date.parse(op.expiresAt) <= markerAt)
            fail("APN_REPREPARE_REQUIRED", "approval_marker_after_prepare_expiry");
        const approvalFinalityDeadline = new Date(markerAt + (op.approvalFinalityWindowMs ?? 0)).toISOString();
        const hash = keccak256(raw);
        op = transition({ ...op, approvalTransactionHash: hash,
            ...(op.schemaVersion === "apn.stargate-v2-token-operation.v5" ? { approvalSubmissionStartedAt: new Date(markerAt).toISOString(), approvalFinalityDeadline } : {}) }, "allowance_submission_started", "approval_attempt_marked_before_send", markerAt);
        await journal.save(op);
        try {
            if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase())
                fail("APN_RPC_AMBIGUOUS", "approval_hash");
            op = transition(op, "allowance_submitted", "approval_broadcast_returned_exact_hash", now());
            await journal.save(op);
        }
        catch {
            op = transition(op, "allowance_unknown_finality", "approval_broadcast_ambiguous_no_resend", now());
            await journal.save(op);
            return op;
        }
        op = await observeAllowance(op, ports, journal);
        if (op.phase !== "allowance_observed")
            return op;
    }
    if (op.schemaVersion === "apn.stargate-v2-token-operation.v5" && op.allowanceRequired) {
        if (op.approvalFinalityDeadline === undefined || now() >= Date.parse(op.approvalFinalityDeadline))
            return await requireCleanup(op, ports, journal, "approval_finality_deadline_passed", true);
        if (op.phase === "allowance_observed" && op.postApprovalQuote === undefined) {
            let postApprovalQuote;
            try {
                postApprovalQuote = await createPostApprovalQuote(op, ports);
            }
            catch (error) {
                return await requireCleanup(op, ports, journal, error instanceof ApnError ? `post_approval_quote_${String(error.details?.reason ?? error.code)}` : "post_approval_quote_unavailable");
            }
            op = transition({ ...op, postApprovalQuote }, "post_approval_quote_bound", "fresh_post_approval_quote_bound", now());
            await journal.save(op);
        }
        if (op.postApprovalQuote === undefined || op.phase !== "post_approval_quote_bound")
            fail("APN_STATE_CORRUPT", "post_approval_quote_missing");
        if (now() >= Date.parse(op.postApprovalQuote.expiresAt))
            return await requireCleanup(op, ports, journal, "post_approval_quote_expired");
    }
    try {
        await freshPreflight(op, ports, "before_send");
        await ports.confirmPolicy(op);
        const identity = await ports.signerIdentity();
        if (canonicalProfile(identity.profile) !== op.profile || address(identity.address) !== op.owner || address(ports.signer.address) !== op.owner)
            fail("APN_REPREPARE_REQUIRED", "signer_identity_changed");
    }
    catch (error) {
        return await requireCleanup(op, ports, journal, error instanceof ApnError ? String(error.details?.reason ?? error.code) : "bridge_preflight_failed");
    }
    op = await markUsageTarget(op, "reserved", journal);
    try {
        op = await reconcileUsage(op, ports, journal);
    }
    catch (error) {
        op = await requireCleanup(op, ports, journal, error instanceof ApnError ? `usage_reservation_${String(error.code).toLowerCase()}` : "usage_reservation_failed");
        op = await markUsageTarget(op, "failed_before_effect", journal);
        try {
            op = await reconcileUsage(op, ports, journal);
        }
        catch { /* durable target retries */ }
        return op;
    }
    let raw;
    const bridgeEnvelope = op.postApprovalQuote?.sendEnvelope ?? op.sendEnvelope;
    try {
        raw = await ports.signer.signTransaction(bridgeEnvelope);
        await verifySignedEnvelope(raw, op.owner, bridgeEnvelope);
        if (op.postApprovalQuote !== undefined && now() >= Date.parse(op.postApprovalQuote.expiresAt))
            fail("APN_REPREPARE_REQUIRED", "post_approval_quote_expired_before_marker");
    }
    catch (error) {
        op = await requireCleanup(op, ports, journal, "bridge_signing_failed");
        op = await markUsageTarget(op, "failed_before_effect", journal);
        try {
            await reconcileUsage(op, ports, journal);
        }
        catch { /* durable target retries */ }
        throw error;
    }
    const hash = keccak256(raw);
    op = transition({ ...op, transactionHash: hash }, "submission_started", "bridge_attempt_marked_before_send", now());
    await journal.save(op);
    try {
        if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase())
            fail("APN_RPC_AMBIGUOUS", "send_hash");
    }
    catch {
        op = transition(op, "unknown_finality", "bridge_broadcast_ambiguous_no_resend", now());
        await journal.save(op);
        op = await markUsageTarget(op, "unknown_finality", journal);
        try {
            op = await reconcileUsage(op, ports, journal);
        }
        catch { /* durable target retries */ }
        return op;
    }
    op = transition(op, "submitted", "bridge_broadcast_returned_exact_hash", now());
    await journal.save(op);
    op = await markUsageTarget(op, "submitted", journal);
    op = await reconcileUsage(op, ports, journal);
    return await observeBridge(op, ports, journal);
}
async function observeAllowance(op, ports, journal) {
    if (op.approvalTransactionHash === undefined)
        fail("APN_STATE_CORRUPT", "approval_hash_missing");
    const receipt = await ports.waitSourceReceipt(op.approvalTransactionHash, op.finalityPolicy.source.blockTag);
    const now = (ports.now ?? Date.now)();
    if (receipt === null) {
        if (op.schemaVersion === "apn.stargate-v2-token-operation.v5" &&
            (op.approvalFinalityDeadline === undefined || now >= Date.parse(op.approvalFinalityDeadline)))
            return await requireCleanup(op, ports, journal, "approval_finality_deadline_passed", true);
        if (op.phase !== "allowance_unknown_finality") {
            op = transition(op, "allowance_unknown_finality", "approval_receipt_not_safe", now);
            await journal.save(op);
        }
        return op;
    }
    if (receipt.finality !== op.finalityPolicy.source.blockTag || receipt.transactionHash !== op.approvalTransactionHash)
        return await requireCleanup(op, ports, journal, "approval_receipt_mismatched", true);
    if (receipt.status !== "success")
        return await requireCleanup(op, ports, journal, "approval_confirmed_revert", false);
    if (op.schemaVersion === "apn.stargate-v2-token-operation.v5" &&
        (op.approvalFinalityDeadline === undefined || now >= Date.parse(op.approvalFinalityDeadline)))
        return await requireCleanup(op, ports, journal, "approval_safe_after_finality_deadline", true);
    const allowance = await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag);
    if (allowance !== BigInt(op.amountAtomic))
        fail("APN_RPC_PROTOCOL", "approval_allowance_not_exact");
    op = transition(op, "allowance_observed", "exact_allowance_safe", now);
    await journal.save(op);
    return op;
}
async function observeBridge(op, ports, journal) {
    if (op.transactionHash === undefined)
        fail("APN_STATE_CORRUPT", "bridge_hash_missing");
    const receipt = await ports.waitSourceReceipt(op.transactionHash, op.finalityPolicy.source.blockTag);
    if (receipt === null) {
        if (op.phase !== "unknown_finality") {
            op = transition(op, "unknown_finality", "source_receipt_not_safe", (ports.now ?? Date.now)());
            await journal.save(op);
        }
        op = await markUsageTarget(op, "unknown_finality", journal);
        return await reconcileUsage(op, ports, journal);
    }
    if (receipt.status === "reverted") {
        if (receipt.transactionHash !== op.transactionHash || receipt.finality !== op.finalityPolicy.source.blockTag)
            fail("APN_RPC_PROTOCOL", "source_revert_receipt");
        op = await requireCleanup(op, ports, journal, "bridge_confirmed_revert");
        op = await markUsageTarget(op, "failed_confirmed_revert", journal);
        return await reconcileUsage(op, ports, journal);
    }
    const source = sourceReceipt(op, receipt);
    const residual = await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag);
    const destinationBaseline = op.postApprovalQuote?.destinationSnapshot ?? {
        tokenBalanceAtomic: op.destinationTokenBalanceBeforeAtomic, nativeBalanceAtomic: op.destinationNativeBalanceBeforeAtomic,
        blockNumberAtomic: op.destinationBalanceBlock.numberAtomic, blockHash: op.destinationBalanceBlock.hash
    };
    const destination = await ports.observeDestination({ sourceTransactionHash: source.transactionHash, guid: source.guid, recipient: op.recipient,
        sourceEid: 30111, destinationPool: STARGATE_TOKEN_DESTINATION_POOL, minimumAmountAtomic: source.amountReceivedAtomic,
        tokenBalanceBeforeAtomic: destinationBaseline.tokenBalanceAtomic, nativeBalanceBeforeAtomic: destinationBaseline.nativeBalanceAtomic,
        nativeDropAtomic: op.nativeDropAtomic, fromBlockNumberAtomic: destinationBaseline.blockNumberAtomic, fromBlockHash: destinationBaseline.blockHash,
        ...(source.packet === undefined ? {} : { sourcePacket: source.packet }),
        finalityTag: op.finalityPolicy.destination.blockTag });
    if (destination === null) {
        if (op.sourceReceipt === undefined || op.residualAllowanceAtomic === undefined) {
            const evidence = { ...op, sourceReceipt: source, residualAllowanceAtomic: residual.toString() };
            op = op.phase === "submitted" ? seal(evidence) : transition(evidence, "submitted", "source_safe_destination_pending", (ports.now ?? Date.now)());
            await journal.save(op);
        }
        op = await markUsageTarget(op, "submitted", journal);
        return await reconcileUsage(op, ports, journal);
    }
    validateDestination(op, source, destination);
    if (residual !== 0n)
        return await requireCleanup({ ...op, sourceReceipt: source, destinationEvidence: destination }, ports, journal, "residual_allowance_after_delivery");
    op = transition({ ...op, sourceReceipt: source, residualAllowanceAtomic: "0", destinationEvidence: destination }, "observed", "destination_token_and_native_drop_safe", (ports.now ?? Date.now)());
    await journal.save(op);
    op = await markUsageTarget(op, "finalized", journal);
    return await reconcileUsage(op, ports, journal);
}
async function requireCleanup(op, ports, journal, reason, forceApprovalZero = false) {
    const residual = await readAllowance(ports.sourceCall, op.owner, "pending");
    if (residual !== 0n && residual !== BigInt(op.amountAtomic))
        fail("APN_OPERATION_BLOCKED", "unexpected_residual_allowance");
    op = transition({ ...op, residualAllowanceAtomic: residual.toString(), cleanupReason: reason }, "cleanup_required", residual === 0n ? "cleanup_not_needed_allowance_already_zero" : "explicit_cleanup_required", (ports.now ?? Date.now)());
    await journal.save(op);
    if (residual === 0n && !forceApprovalZero) {
        op = await finishCleanup(op, ports, journal, "zero_residual_allowance_proven");
    }
    return op;
}
/** Explicit foreground cleanup. Observation remains separate and never invokes this signer path. */
export async function cleanupStargateV2Token(id, ports, journal) {
    const initial = await journal.load(id);
    if (initial === null)
        fail("APN_OPERATION_BLOCKED", "operation_missing");
    return await journal.withOwnerChainLock(initial.owner, 10, async () => await journal.withLock(id, async () => {
        let op = await journal.load(id);
        if (op === null)
            fail("APN_OPERATION_BLOCKED", "operation_missing");
        op = await reconcileUsageOrCleanup(op, ports, journal);
        if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase))
            return await observeCleanup(op, ports, journal);
        if (op.phase === "cleaned" || op.phase === "observed")
            return op;
        if (op.phase !== "cleanup_required")
            fail("APN_OPERATION_BLOCKED", "cleanup_not_required");
        if (op.finalityPolicyProvenance === "derived_legacy_v1" && op.residualAllowanceAtomic !== op.amountAtomic)
            fail("APN_OPERATION_BLOCKED", "legacy_cleanup_not_proven");
        const allowance = await readAllowance(ports.sourceCall, op.owner, "pending");
        const forceApprovalZero = op.cleanupReason === "approval_finality_deadline_passed" || op.cleanupReason === "approval_safe_after_finality_deadline" || op.cleanupReason === "approval_receipt_mismatched";
        if (allowance === 0n && !forceApprovalZero)
            return await finishCleanup({ ...op, residualAllowanceAtomic: "0" }, ports, journal, "zero_residual_allowance_proven");
        if (allowance !== 0n && allowance !== BigInt(op.amountAtomic))
            fail("APN_OPERATION_BLOCKED", "unexpected_residual_allowance");
        const data = encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "approve", args: [STARGATE_TOKEN_SOURCE_POOL, 0n] });
        const prepared = await ports.prepareEnvelope({ chainId: 10, from: op.owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data, valueAtomic: "0" });
        const cleanupEnvelope = { chainId: 10, from: op.owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data, valueAtomic: "0",
            nonceAtomic: uint(prepared.nonceAtomic).toString(), gasLimitAtomic: uint(prepared.gasLimitAtomic, true).toString(),
            maxFeePerGasAtomic: uint(prepared.maxFeePerGasAtomic, true).toString(), maxPriorityFeePerGasAtomic: uint(prepared.maxPriorityFeePerGasAtomic).toString() };
        const tx = { from: op.owner, to: cleanupEnvelope.to, data, value: "0x0", gas: `0x${BigInt(cleanupEnvelope.gasLimitAtomic).toString(16)}`,
            maxFeePerGas: `0x${BigInt(cleanupEnvelope.maxFeePerGasAtomic).toString(16)}`, maxPriorityFeePerGas: `0x${BigInt(cleanupEnvelope.maxPriorityFeePerGasAtomic).toString(16)}` };
        const simulation = await ports.sourceCall("eth_call", [tx, "pending"]);
        if (decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "approve", data: simulation }) !== true)
            fail("APN_REPREPARE_REQUIRED", "cleanup_simulation");
        const identity = await ports.signerIdentity();
        if (canonicalProfile(identity.profile) !== op.profile || address(identity.address) !== op.owner)
            fail("APN_REPREPARE_REQUIRED", "signer_identity_changed");
        op = seal({ ...op, cleanupEnvelope });
        await journal.save(op);
        await ports.approveCleanup(op);
        const raw = await ports.signer.signTransaction(cleanupEnvelope);
        await verifySignedEnvelope(raw, op.owner, cleanupEnvelope);
        const hash = keccak256(raw);
        op = transition({ ...op, cleanupTransactionHash: hash }, "cleanup_submission_started", "cleanup_attempt_marked_before_send", (ports.now ?? Date.now)());
        await journal.save(op);
        try {
            if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase())
                fail("APN_RPC_AMBIGUOUS", "cleanup_hash");
            op = transition(op, "cleanup_submitted", "cleanup_broadcast_returned_exact_hash", (ports.now ?? Date.now)());
            await journal.save(op);
        }
        catch {
            op = transition(op, "cleanup_unknown_finality", "cleanup_broadcast_ambiguous_no_resend", (ports.now ?? Date.now)());
            await journal.save(op);
            return op;
        }
        return await observeCleanup(op, ports, journal);
    }));
}
async function observeCleanup(op, ports, journal) {
    if (op.cleanupTransactionHash === undefined)
        fail("APN_STATE_CORRUPT", "cleanup_hash_missing");
    const receipt = await ports.waitSourceReceipt(op.cleanupTransactionHash, op.finalityPolicy.source.blockTag);
    if (receipt === null) {
        if (op.phase !== "cleanup_unknown_finality") {
            op = transition(op, "cleanup_unknown_finality", "cleanup_receipt_not_safe", (ports.now ?? Date.now)());
            await journal.save(op);
        }
        return op;
    }
    if (receipt.status !== "success" || receipt.finality !== op.finalityPolicy.source.blockTag || receipt.transactionHash !== op.cleanupTransactionHash)
        fail("APN_OPERATION_BLOCKED", "cleanup_failed_or_mismatched");
    if (await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag) !== 0n)
        fail("APN_OPERATION_BLOCKED", "cleanup_allowance_not_zero");
    return await finishCleanup({ ...op, residualAllowanceAtomic: "0" }, ports, journal, "cleanup_safe_zero_allowance");
}
async function finishCleanup(op, ports, journal, reason) {
    const delivered = op.sourceReceipt !== undefined && op.destinationEvidence !== undefined;
    op = transition(op, delivered ? "observed" : "cleaned", reason, (ports.now ?? Date.now)());
    await journal.save(op);
    if (delivered) {
        op = await markUsageTarget(op, "finalized", journal);
        op = await reconcileUsage(op, ports, journal);
    }
    return op;
}
async function markUsageTarget(op, target, journal) {
    op = seal({ ...op, usageTarget: target });
    await journal.save(op);
    return op;
}
async function reconcileUsage(op, ports, journal) {
    if (op.usageTarget === undefined)
        return op;
    const state = op.usageTarget === "reserved" ? await ports.reserveUsage(op) : await ports.followUsage(op, op.usageTarget);
    const { usageTarget: _target, ...settled } = op;
    op = seal({ ...settled, usageState: state });
    await journal.save(op);
    return op;
}
async function reconcileUsageOrCleanup(op, ports, journal) {
    try {
        return await reconcileUsage(op, ports, journal);
    }
    catch (error) {
        if (op.usageTarget !== "reserved")
            throw error;
        op = await requireCleanup(op, ports, journal, error instanceof ApnError ? `usage_reservation_${String(error.code).toLowerCase()}` : "usage_reservation_failed");
        op = await markUsageTarget(op, "failed_before_effect", journal);
        try {
            return await reconcileUsage(op, ports, journal);
        }
        catch {
            return op;
        }
    }
}
/** Local ledger reconciliation for status/recovery callers; this never signs, broadcasts, or performs RPC. */
export async function reconcileStargateV2TokenUsage(id, ports, journal) {
    return await journal.withLock(id, async () => {
        const op = await journal.load(id);
        if (op === null)
            fail("APN_OPERATION_BLOCKED", "operation_missing");
        return await reconcileUsage(op, ports, journal);
    });
}
async function createPostApprovalQuote(op, ports) {
    const now = ports.now ?? Date.now;
    if (op.schemaVersion !== "apn.stargate-v2-token-operation.v5" || op.phase !== "allowance_observed" ||
        op.postApprovalQuote !== undefined || op.approvalFinalityDeadline === undefined)
        fail("APN_STATE_CORRUPT", "post_approval_quote_state");
    if (now() >= Date.parse(op.approvalFinalityDeadline))
        fail("APN_REPREPARE_REQUIRED", "approval_finality_deadline_passed");
    await ports.confirmPolicy(op);
    assertStargateV2RouteFinalityPolicy(op.finalityPolicy, STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_DESTINATION_CHAIN);
    const quote = await quoteStargateV2Direct({ sourceChainId: 10, destinationChainId: 137, sourceToken: STARGATE_TOKEN_SOURCE_TOKEN,
        destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, recipient: op.recipient, amountAtomic: op.amountAtomic, extraOptions: op.options }, ports.sourceCall);
    assertLane(quote);
    if (quote.quote.amountSentAtomic !== op.amountAtomic)
        fail("APN_REPREPARE_REQUIRED", "post_approval_amount_changed");
    if (BigInt(quote.quote.minimumOutputAtomic) < BigInt(op.minOutputAtomic))
        fail("APN_REPREPARE_REQUIRED", "post_approval_minimum_output");
    const [cap, source, destination, allowance, tokenBalance, destinationBalance] = await Promise.all([
        readExecutorCap(ports.sourceCall, "latest"),
        readPoolConfig(ports.sourceCall, 10, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, 30111, "latest"),
        readPoolConfig(ports.destinationCall, 137, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, 30109, "latest"),
        readAllowance(ports.sourceCall, op.owner, "pending"),
        readTokenBalance(ports.sourceCall, STARGATE_TOKEN_SOURCE_TOKEN, op.owner, "pending"),
        ports.destinationBalances(op.recipient, op.finalityPolicy.destination.blockTag),
    ]);
    if (BigInt(op.nativeDropAtomic) > cap)
        fail("APN_REPREPARE_REQUIRED", "post_approval_native_drop_cap");
    if (source.poolCodeHash !== op.sourceCodeHash || source.tokenCodeHash !== op.sourceTokenCodeHash ||
        destination.poolCodeHash !== op.destinationCodeHash || destination.tokenCodeHash !== op.destinationTokenCodeHash)
        fail("APN_REPREPARE_REQUIRED", "post_approval_code_changed");
    if (allowance !== BigInt(op.amountAtomic))
        fail("APN_REPREPARE_REQUIRED", "post_approval_allowance");
    if (tokenBalance < BigInt(op.amountAtomic))
        fail("APN_REPREPARE_REQUIRED", "post_approval_token_balance");
    const sendParam = { dstEid: 30109, to: pad(op.recipient, { size: 32 }), amountLD: BigInt(op.amountAtomic),
        minAmountLD: BigInt(quote.quote.minimumOutputAtomic), extraOptions: op.options, composeMsg: "0x", oftCmd: "0x" };
    const exactFee = await requoteSend(ports.sourceCall, sendParam, `0x${BigInt(quote.block.numberAtomic).toString(16)}`);
    if (exactFee !== BigInt(quote.quote.nativeMessageFeeAtomic))
        fail("APN_REPREPARE_REQUIRED", "post_approval_exact_send_fee_changed");
    const sendData = encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: "sendToken", args: [sendParam,
            { nativeFee: exactFee, lzTokenFee: 0n }, op.owner] });
    const prepared = await ports.prepareEnvelope({ chainId: 10, from: op.owner, to: STARGATE_TOKEN_SOURCE_POOL,
        data: sendData, valueAtomic: exactFee.toString() });
    const expectedNonce = BigInt(op.approvalEnvelope.nonceAtomic) + 1n;
    if (BigInt(prepared.nonceAtomic) !== expectedNonce)
        fail("APN_REPREPARE_REQUIRED", "post_approval_nonce_changed");
    const quotedMaxFee = uint(prepared.maxFeePerGasAtomic, true), quotedPriority = uint(prepared.maxPriorityFeePerGasAtomic);
    const feeCeiling = op.feeApproval;
    if (quotedPriority > quotedMaxFee || quotedMaxFee > BigInt(feeCeiling.approvedMaxFeePerGasWei) ||
        quotedPriority > BigInt(feeCeiling.approvedMaxPriorityFeePerGasWei))
        fail("APN_REPREPARE_REQUIRED", "post_approval_fee_ceiling");
    const gasCeiling = BigInt(op.bridgeSimulation.gasCeilingAtomic);
    const sendEnvelope = { chainId: 10, from: op.owner, to: STARGATE_TOKEN_SOURCE_POOL, data: sendData,
        valueAtomic: exactFee.toString(), nonceAtomic: expectedNonce.toString(), gasLimitAtomic: gasCeiling.toString(),
        maxFeePerGasAtomic: feeCeiling.approvedMaxFeePerGasWei, maxPriorityFeePerGasAtomic: feeCeiling.approvedMaxPriorityFeePerGasWei };
    const tx = rpcEnvelope(sendEnvelope);
    const [simulation, estimateRaw] = await Promise.all([
        ports.sourceCall("eth_call", [tx, "pending"]).catch(() => fail("APN_REPREPARE_REQUIRED", "post_approval_send_simulation")),
        ports.sourceCall("eth_estimateGas", [tx, "pending"]).catch(() => fail("APN_REPREPARE_REQUIRED", "post_approval_send_estimate")),
    ]);
    const estimate = quantity(estimateRaw);
    if (estimate > gasCeiling)
        fail("APN_REPREPARE_REQUIRED", "post_approval_gas_limit");
    try {
        const decoded = decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sendToken", data: simulation });
        if (decoded[1].amountSentLD.toString() !== op.amountAtomic || decoded[1].amountReceivedLD.toString() !== quote.quote.minimumOutputAtomic)
            throw 0;
    }
    catch {
        fail("APN_REPREPARE_REQUIRED", "post_approval_send_simulation");
    }
    const approvalDebit = BigInt(op.approvalEnvelope.gasLimitAtomic) * BigInt(op.approvalEnvelope.maxFeePerGasAtomic);
    const maximumDebit = approvalDebit + exactFee + gasCeiling * BigInt(sendEnvelope.maxFeePerGasAtomic);
    if (maximumDebit > BigInt(op.maxNativeDebitAtomic))
        fail("APN_REPREPARE_REQUIRED", "post_approval_max_native_debit");
    if (BigInt(prepared.nativeBalanceAtomic) < exactFee + gasCeiling * BigInt(sendEnvelope.maxFeePerGasAtomic))
        fail("APN_REPREPARE_REQUIRED", "post_approval_native_balance");
    const quotedAtMs = now(), expiresAtMs = Math.min(quotedAtMs + STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS, Date.parse(op.approvalFinalityDeadline));
    if (expiresAtMs <= quotedAtMs)
        fail("APN_REPREPARE_REQUIRED", "post_approval_quote_expired");
    const body = { schemaVersion: "apn.stargate-v2-token-post-approval-quote.v1",
        quotedAt: new Date(quotedAtMs).toISOString(), expiresAt: new Date(expiresAtMs).toISOString(), quote, quoteBlock: quote.block,
        ownerApprovedMinimumOutputAtomic: op.minOutputAtomic,
        ownerApprovedMaximumQuoteLossAtomic: (BigInt(op.amountAtomic) - BigInt(op.minOutputAtomic)).toString(),
        finalityPolicy: op.finalityPolicy, executorNativeCapAtomic: cap.toString(), sourceCodeHash: source.poolCodeHash,
        destinationCodeHash: destination.poolCodeHash, sourceTokenCodeHash: source.tokenCodeHash,
        destinationTokenCodeHash: destination.tokenCodeHash, policy: op.policy,
        sourceSnapshot: { tokenBalanceAtomic: tokenBalance.toString(), nativeBalanceAtomic: prepared.nativeBalanceAtomic,
            allowanceAtomic: allowance.toString(), nonceAtomic: prepared.nonceAtomic, quotedMaxFeePerGasWei: quotedMaxFee.toString(),
            quotedMaxPriorityFeePerGasWei: quotedPriority.toString() },
        destinationSnapshot: { tokenBalanceAtomic: destinationBalance.tokenAtomic, nativeBalanceAtomic: destinationBalance.nativeAtomic,
            blockNumberAtomic: destinationBalance.blockNumberAtomic, blockHash: destinationBalance.blockHash },
        bridgeEstimateGasAtomic: estimate.toString(), sendEnvelope, maximumDebitAtomic: maximumDebit.toString() };
    return Object.freeze({ ...body, snapshotHash: hashObject(body) });
}
async function freshPreflight(op, ports, stage) {
    const post = stage === "before_send" ? op.postApprovalQuote : undefined;
    if (Date.parse(post?.expiresAt ?? op.expiresAt) <= (ports.now ?? Date.now)())
        fail("APN_REPREPARE_REQUIRED", post === undefined ? "expired" : "post_approval_quote_expired");
    const expectedQuote = post?.quote ?? op.quote, expectedCap = BigInt(post?.executorNativeCapAtomic ?? op.executorNativeCapAtomic);
    const cap = await readExecutorCap(ports.sourceCall, "latest");
    if (cap !== expectedCap || BigInt(op.nativeDropAtomic) > cap)
        fail("APN_REPREPARE_REQUIRED", "native_drop_cap_changed");
    if (post === undefined) {
        const fresh = await quoteStargateV2Direct({ sourceChainId: 10, destinationChainId: 137, sourceToken: STARGATE_TOKEN_SOURCE_TOKEN,
            destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, recipient: op.recipient, amountAtomic: op.amountAtomic, extraOptions: op.options }, ports.sourceCall);
        if (fresh.quote.amountSentAtomic !== expectedQuote.quote.amountSentAtomic || fresh.quote.minimumOutputAtomic !== expectedQuote.quote.minimumOutputAtomic ||
            fresh.quote.nativeMessageFeeAtomic !== expectedQuote.quote.nativeMessageFeeAtomic)
            fail("APN_REPREPARE_REQUIRED", "quote_changed");
    }
    const effectiveSendEnvelope = post?.sendEnvelope ?? op.sendEnvelope;
    const decodedSend = decodeFunctionData({ abi: STARGATE_SEND_ABI, data: effectiveSendEnvelope.data });
    if (decodedSend.functionName !== "sendToken")
        fail("APN_STATE_CORRUPT", "send_calldata");
    if (await requoteSend(ports.sourceCall, decodedSend.args[0], "latest") !== BigInt(expectedQuote.quote.nativeMessageFeeAtomic))
        fail("APN_REPREPARE_REQUIRED", "exact_send_fee_changed");
    const [source, destination, balance, nativeBalance, allowance, nonce, latest, priorityRaw] = await Promise.all([
        readPoolConfig(ports.sourceCall, 10, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, 30111, "latest"),
        readPoolConfig(ports.destinationCall, 137, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, 30109, "latest"),
        readTokenBalance(ports.sourceCall, STARGATE_TOKEN_SOURCE_TOKEN, op.owner, "pending"), ports.sourceCall("eth_getBalance", [op.owner, "pending"]),
        readAllowance(ports.sourceCall, op.owner, "pending"),
        ports.sourceCall("eth_getTransactionCount", [op.owner, "pending"]),
        ports.sourceCall("eth_getBlockByNumber", ["latest", false]), ports.sourceCall("eth_maxPriorityFeePerGas", []),
    ]);
    if (source.poolCodeHash !== (post?.sourceCodeHash ?? op.sourceCodeHash) || source.tokenCodeHash !== (post?.sourceTokenCodeHash ?? op.sourceTokenCodeHash) ||
        destination.poolCodeHash !== (post?.destinationCodeHash ?? op.destinationCodeHash) || destination.tokenCodeHash !== (post?.destinationTokenCodeHash ?? op.destinationTokenCodeHash))
        fail("APN_REPREPARE_REQUIRED", "code_changed");
    if (balance < BigInt(op.amountAtomic))
        fail("APN_REPREPARE_REQUIRED", "token_balance");
    const expectedAllowance = stage === "before_approval" ? BigInt(op.initialAllowanceAtomic) : BigInt(op.amountAtomic);
    if (allowance !== expectedAllowance)
        fail("APN_REPREPARE_REQUIRED", "allowance_changed");
    const envelope = stage === "before_approval" ? op.approvalEnvelope : effectiveSendEnvelope;
    if (quantity(nonce).toString() !== envelope.nonceAtomic)
        fail("APN_REPREPARE_REQUIRED", "nonce_changed");
    const remainingDebit = stage === "before_approval" ? BigInt(op.maximumDebitAtomic)
        : BigInt(envelope.valueAtomic) + BigInt(envelope.gasLimitAtomic) * BigInt(envelope.maxFeePerGasAtomic);
    if (quantity(nativeBalance) < remainingDebit)
        fail("APN_REPREPARE_REQUIRED", "native_balance");
    const block = latest, priority = quantity(priorityRaw), freshMaxFee = 2n * quantity(block.baseFeePerGas) + priority;
    const feeCeiling = op.feeApproval ?? { approvedMaxFeePerGasWei: envelope.maxFeePerGasAtomic, approvedMaxPriorityFeePerGasWei: envelope.maxPriorityFeePerGasAtomic };
    if (freshMaxFee > BigInt(feeCeiling.approvedMaxFeePerGasWei) || priority > BigInt(feeCeiling.approvedMaxPriorityFeePerGasWei))
        fail("APN_REPREPARE_REQUIRED", "fee_spike");
    const tx = rpcEnvelope(envelope);
    const [simulation, estimate] = await Promise.all([
        ports.sourceCall("eth_call", [tx, "pending"]).catch(() => fail("APN_REPREPARE_REQUIRED", stage === "before_approval" ? "approval_simulation" : "send_simulation")),
        ports.sourceCall("eth_estimateGas", [tx, "pending"]).catch(() => fail("APN_REPREPARE_REQUIRED", stage === "before_approval" ? "approval_estimate" : "send_estimate")),
    ]);
    if (quantity(estimate) > BigInt(envelope.gasLimitAtomic))
        fail("APN_REPREPARE_REQUIRED", "gas_limit");
    if (stage === "before_send") {
        const approvalGasDebit = op.approvalEnvelope === undefined ? 0n : BigInt(op.approvalEnvelope.gasLimitAtomic) * BigInt(op.approvalEnvelope.maxFeePerGasAtomic);
        const recomputed = approvalGasDebit + BigInt(envelope.valueAtomic) + quantity(estimate) * freshMaxFee;
        if (recomputed > BigInt(op.maxNativeDebitAtomic))
            fail("APN_REPREPARE_REQUIRED", "recomputed_native_debit");
    }
    if (stage === "before_approval") {
        try {
            if (decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "approve", data: simulation }) !== true)
                throw 0;
        }
        catch {
            fail("APN_REPREPARE_REQUIRED", "approval_simulation");
        }
    }
    else {
        try {
            const decoded = decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sendToken", data: simulation });
            if (decoded[1].amountSentLD.toString() !== op.amountAtomic || decoded[1].amountReceivedLD.toString() !== expectedQuote.quote.minimumOutputAtomic)
                throw 0;
        }
        catch {
            fail("APN_REPREPARE_REQUIRED", "send_simulation");
        }
    }
}
//# sourceMappingURL=token-execution.js.map