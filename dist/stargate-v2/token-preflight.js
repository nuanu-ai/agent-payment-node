import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, pad } from "viem";
import { hashObject } from "../canonical.js";
import { evmFrozenFeeAdmitted } from "../evm-fee-admission.js";
import { STARGATE_ERC20_ABI, STARGATE_SEND_ABI } from "./abi.js";
import { assertStargateV2RouteFinalityPolicy } from "./finality-policy.js";
import { quoteStargateV2Direct } from "./quote.js";
import { STARGATE_TOKEN_DESTINATION_CHAIN, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS, STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, fail, quantity, uint, } from "./token-codec.js";
import { assertLane, readAllowance, readExecutorCap, readPoolFunctional, readTokenBalance, requoteSend, rpcEnvelope } from "./token-rpc.js";
/** The pre-signing reads of a token Stargate send: the fresh post-approval quote, the frozen fee admission and the preflight. */
export async function createPostApprovalQuote(op, ports) {
    const now = ports.now ?? Date.now;
    if (op.phase !== "allowance_observed" ||
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
    // P2/P5: the pinned pools' functional configuration is re-read; their runtime code was recorded once at prepare.
    const [cap, , , allowance, tokenBalance, destinationBalance] = await Promise.all([
        readExecutorCap(ports.sourceCall, "latest"),
        readPoolFunctional(ports.sourceCall, 10, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, 30111, "latest"),
        readPoolFunctional(ports.destinationCall, 137, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, 30109, "latest"),
        readAllowance(ports.sourceCall, op.owner, "pending"),
        readTokenBalance(ports.sourceCall, STARGATE_TOKEN_SOURCE_TOKEN, op.owner, "pending"),
        ports.destinationBalances(op.recipient, op.finalityPolicy.destination.blockTag),
    ]);
    if (BigInt(op.nativeDropAtomic) > cap)
        fail("APN_REPREPARE_REQUIRED", "post_approval_native_drop_cap");
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
    // The bridge is signed with the owner-approved fee fields; a fresh 2 × base + tip estimate is recorded, not compared.
    // freshPreflight("before_send") admits the frozen envelope only while it can be included now.
    if (quotedPriority > quotedMaxFee)
        fail("APN_RPC_PROTOCOL", "post_approval_priority_fee");
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
        finalityPolicy: op.finalityPolicy, executorNativeCapAtomic: cap.toString(), sourceCodeHash: op.sourceCodeHash,
        destinationCodeHash: op.destinationCodeHash, sourceTokenCodeHash: op.sourceTokenCodeHash,
        destinationTokenCodeHash: op.destinationTokenCodeHash, policy: op.policy,
        sourceSnapshot: { tokenBalanceAtomic: tokenBalance.toString(), nativeBalanceAtomic: prepared.nativeBalanceAtomic,
            allowanceAtomic: allowance.toString(), nonceAtomic: prepared.nonceAtomic, quotedMaxFeePerGasWei: quotedMaxFee.toString(),
            quotedMaxPriorityFeePerGasWei: quotedPriority.toString() },
        destinationSnapshot: { tokenBalanceAtomic: destinationBalance.tokenAtomic, nativeBalanceAtomic: destinationBalance.nativeAtomic,
            blockNumberAtomic: destinationBalance.blockNumberAtomic, blockHash: destinationBalance.blockHash },
        bridgeEstimateGasAtomic: estimate.toString(), sendEnvelope, maximumDebitAtomic: maximumDebit.toString() };
    return Object.freeze({ ...body, snapshotHash: hashObject(body) });
}
/** The one fee rule for a send whose quote was bound in this invocation: the frozen envelope must be includable now. */
export async function sendFeeAdmitted(op, ports) {
    const e = op.postApprovalQuote?.sendEnvelope ?? op.sendEnvelope, latest = await ports.sourceCall("eth_getBlockByNumber", ["latest", false]);
    if (!evmFrozenFeeAdmitted(quantity(latest.baseFeePerGas), { maxFeePerGasWei: BigInt(e.maxFeePerGasAtomic),
        maxPriorityFeePerGasWei: BigInt(e.maxPriorityFeePerGasAtomic) }))
        fail("APN_REPREPARE_REQUIRED", "fee_spike");
}
export async function freshPreflight(op, ports, stage) {
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
    const [, , balance, nativeBalance, allowance, nonce, latest] = await Promise.all([
        readPoolFunctional(ports.sourceCall, 10, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, 30111, "latest"),
        readPoolFunctional(ports.destinationCall, 137, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, 30109, "latest"),
        readTokenBalance(ports.sourceCall, STARGATE_TOKEN_SOURCE_TOKEN, op.owner, "pending"), ports.sourceCall("eth_getBalance", [op.owner, "pending"]),
        readAllowance(ports.sourceCall, op.owner, "pending"),
        ports.sourceCall("eth_getTransactionCount", [op.owner, "pending"]),
        ports.sourceCall("eth_getBlockByNumber", ["latest", false]),
    ]);
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
    // One fee rule: each frozen envelope must be includable now; its signed gas × maxFeePerGas is the owner-approved spend bound.
    // Before the approval, the bridge envelope that follows is admitted too, so an already inadmissible fee never buys an approval.
    const baseFee = quantity(latest.baseFeePerGas);
    const admitted = (e) => evmFrozenFeeAdmitted(baseFee, { maxFeePerGasWei: BigInt(e.maxFeePerGasAtomic), maxPriorityFeePerGasWei: BigInt(e.maxPriorityFeePerGasAtomic) });
    if (!admitted(envelope) || (stage === "before_approval" && !admitted(effectiveSendEnvelope)))
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
        const recomputed = approvalGasDebit + BigInt(envelope.valueAtomic) + quantity(estimate) * BigInt(envelope.maxFeePerGasAtomic);
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
//# sourceMappingURL=token-preflight.js.map