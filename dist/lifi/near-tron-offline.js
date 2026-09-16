/**
 * Offline inspection of a saved synthetic LI.FI Base USDC -> TRON USDT quote.
 * The LI.FI API's TRON ID (728126428) differs from the facet's custom ID
 * (1885080386571452). Source ABI and custom ID are pinned to
 * lifinance/contracts@6a670100f9d011e39fbf2fe973493de0a50cf970.
 * No route admission, signing, approval or submission imports this module.
 */
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from "viem";
import { canonicalJson, sha256 } from "../canonical.js";
import { tronWord } from "../tron/codec.js";
import { BASE_TRON_USDT_CANDIDATE } from "./discovery-candidates.js";
import { FEE_FORWARDER, FEE_FORWARDER_SELECTOR, FEE_RECIPIENT, feeForwarderAbi } from "./abi.js";
import { BRIDGE_DIAMOND, BRIDGE_MAX_CALLDATA_BYTES, BRIDGE_ZERO_ADDRESS, bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint } from "./validation.js";
const SOURCE_TOKEN = getAddress(BASE_TRON_USDT_CANDIDATE.fromToken);
const FACET_TRON_ID = 1885080386571452n;
const NON_EVM_RECEIVER = getAddress("0x11f111f111f111f111f111f111f111f111f111f1");
const SELECTOR = "0x3110c7b9";
const BRIDGE_DATA = "(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)";
const SWAP_DATA = "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[]";
const NEAR_DATA = "(bytes32 nonEVMReceiver,address depositAddress,bytes32 quoteId,uint256 deadline,uint256 minAmountOut,address refundRecipient,bytes signature)";
const ABI = parseAbi([`function swapAndStartBridgeTokensViaNEARIntents(${BRIDGE_DATA},${SWAP_DATA},${NEAR_DATA}) payable`]);
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `near_tron_offline_${reason}`); }
function token(value, chain, address, symbol) {
    const row = bridgeRecord(value);
    return row.chainId === chain && row.address === address && row.symbol === symbol && row.decimals === 6;
}
function amount(value, nonzero = true) { return bridgeUint(value, nonzero); }
function canonical(abi, name, args, data) {
    return encodeFunctionData({ abi, functionName: name, args: args }).toLowerCase() === data.toLowerCase();
}
function step(value) { return bridgeRecord(value); }
/** Inspect source bytes only; never admit or complete a bridge operation. */
export function inspectNearBaseTronQuoteOffline(value, binding) {
    const q = bridgeRecord(value), action = bridgeRecord(q.action), estimate = bridgeRecord(q.estimate), tx = bridgeRecord(q.transactionRequest);
    const sender = bridgeAddress(binding.sender), source = amount(binding.sourceAmountAtomic), maxFee = amount(binding.maxFeeAtomic, false);
    const minRequired = amount(binding.minOutputAtomic), quoted = amount(estimate.toAmount), quotedMin = amount(estimate.toAmountMin);
    const recipient = binding.tronRecipient;
    const expectedWord = `0x${tronWord(recipient)}`; // canonical Base58Check, 0x41 network byte removed
    if (q.type !== "lifi" || q.tool !== "near" || q.integrator !== "lifi-api" ||
        action.fromChainId !== 8453 || action.toChainId !== BASE_TRON_USDT_CANDIDATE.toChainId || action.fromAmount !== source.toString() ||
        action.fromAddress !== sender || action.toAddress !== recipient ||
        !token(action.fromToken, 8453, SOURCE_TOKEN, "USDC") ||
        !token(action.toToken, BASE_TRON_USDT_CANDIDATE.toChainId, BASE_TRON_USDT_CANDIDATE.toToken, "USDT") ||
        estimate.tool !== "near" || estimate.fromAmount !== source.toString() || quotedMin > quoted || quotedMin < minRequired || quoted > source ||
        bridgeAddress(estimate.approvalAddress) !== BRIDGE_DIAMOND || tx.chainId !== 8453 || bridgeAddress(tx.from) !== sender ||
        bridgeAddress(tx.to) !== BRIDGE_DIAMOND || tx.value !== "0x0" ||
        typeof tx.gasLimit !== "string" || !/^0x[0-9a-f]+$/u.test(tx.gasLimit) || BigInt(tx.gasLimit) <= 0n || BigInt(tx.gasLimit) > 5000000n)
        fail("quote_binding");
    const data = bridgeHex(tx.data, BRIDGE_MAX_CALLDATA_BYTES);
    if (data.slice(0, 10) !== SELECTOR)
        fail("source_selector");
    let bridge, swaps, near;
    try {
        const decoded = decodeFunctionData({ abi: ABI, data });
        if (decoded.functionName !== "swapAndStartBridgeTokensViaNEARIntents" || !canonical(ABI, decoded.functionName, decoded.args, data))
            fail("source_noncanonical");
        [bridge, swaps, near] = decoded.args;
    }
    catch (error) {
        if (error instanceof Error && error.name === "ApnError")
            throw error;
        return fail("source_abi");
    }
    if (bridge.transactionId === `0x${"0".repeat(64)}` || q.transactionId !== bridge.transactionId ||
        bridge.bridge !== "near" || bridge.integrator !== "lifi-api" || bridge.referrer !== BRIDGE_ZERO_ADDRESS ||
        bridge.sendingAssetId !== SOURCE_TOKEN || bridge.receiver !== NON_EVM_RECEIVER || bridge.destinationChainId !== FACET_TRON_ID ||
        !bridge.hasSourceSwaps || bridge.hasDestinationCall || bridge.minAmount <= 0n || bridge.minAmount >= source || swaps.length !== 1)
        fail("bridge_data");
    const fee = source - bridge.minAmount;
    if (fee <= 0n || fee > maxFee)
        fail("fee_cap");
    const swap = swaps[0];
    if (swap.callTo !== FEE_FORWARDER || swap.approveTo !== FEE_FORWARDER || swap.sendingAssetId !== SOURCE_TOKEN ||
        swap.receivingAssetId !== SOURCE_TOKEN || swap.fromAmount !== source || !swap.requiresDeposit ||
        swap.callData.slice(0, 10) !== FEE_FORWARDER_SELECTOR)
        fail("fee_swap");
    try {
        const decoded = decodeFunctionData({ abi: feeForwarderAbi, data: swap.callData });
        if (decoded.functionName !== "forwardERC20Fees" || !canonical(feeForwarderAbi, decoded.functionName, decoded.args, swap.callData))
            fail("fee_noncanonical");
        const [feeToken, distributions] = decoded.args;
        if (feeToken !== SOURCE_TOKEN || distributions.length !== 1 || distributions[0].recipient !== FEE_RECIPIENT || distributions[0].amount !== fee)
            fail("fee_distribution");
    }
    catch (error) {
        if (error instanceof Error && error.name === "ApnError")
            throw error;
        return fail("fee_abi");
    }
    if (near.nonEVMReceiver === `0x${"0".repeat(64)}` || near.nonEVMReceiver.toLowerCase() !== expectedWord ||
        near.depositAddress === BRIDGE_ZERO_ADDRESS || near.quoteId === `0x${"0".repeat(64)}` ||
        near.deadline <= 0n || near.minAmountOut !== quotedMin || near.refundRecipient !== sender ||
        !/^0x[0-9a-f]{130}$/u.test(near.signature.toLowerCase()))
        fail("near_data_or_unreviewed_recipient_encoding");
    const fees = estimate.feeCosts;
    if (!Array.isArray(fees) || fees.length !== 4)
        fail("fee_rows");
    const fixed = bridgeRecord(fees[0]);
    if (fixed.name !== "LIFI Fixed Fee" || fixed.included !== true || fixed.amount !== fee.toString() ||
        !token(fixed.token, 8453, SOURCE_TOKEN, "USDC"))
        fail("fee_rows");
    let protocolFees = 0n;
    for (const item of fees.slice(1)) {
        const row = bridgeRecord(item);
        if (row.included !== true || !token(row.token, 8453, SOURCE_TOKEN, "USDC"))
            fail("fee_rows");
        protocolFees += amount(row.amount);
    }
    if (protocolFees + quoted > bridge.minAmount)
        fail("fee_bound");
    const steps = q.includedSteps;
    if (!Array.isArray(steps) || steps.length !== 2)
        fail("included_steps");
    const feeStep = step(steps[0]), bridgeStep = step(steps[1]);
    const fa = step(feeStep.action), fe = step(feeStep.estimate), ba = step(bridgeStep.action), be = step(bridgeStep.estimate);
    if (feeStep.type !== "protocol" || feeStep.tool !== "feeCollection" || bridgeStep.type !== "cross" || bridgeStep.tool !== "near" ||
        fa.fromChainId !== 8453 || fa.toChainId !== 8453 || fa.fromAddress !== BRIDGE_DIAMOND || fa.toAddress !== BRIDGE_DIAMOND || fa.fromAmount !== source.toString() ||
        !token(fa.fromToken, 8453, SOURCE_TOKEN, "USDC") || !token(fa.toToken, 8453, SOURCE_TOKEN, "USDC") ||
        fe.fromAmount !== source.toString() || fe.toAmount !== bridge.minAmount.toString() || fe.toAmountMin !== bridge.minAmount.toString() ||
        bridgeAddress(fe.approvalAddress) !== FEE_FORWARDER || !Array.isArray(fe.feeCosts) || fe.feeCosts.length !== 1 ||
        canonicalJson(fe.feeCosts[0]) !== canonicalJson(fixed) ||
        ba.fromChainId !== 8453 || ba.toChainId !== BASE_TRON_USDT_CANDIDATE.toChainId || ba.fromAmount !== bridge.minAmount.toString() ||
        ba.fromAddress !== BRIDGE_DIAMOND || ba.toAddress !== recipient || !token(ba.fromToken, 8453, SOURCE_TOKEN, "USDC") ||
        !token(ba.toToken, BASE_TRON_USDT_CANDIDATE.toChainId, BASE_TRON_USDT_CANDIDATE.toToken, "USDT") ||
        be.fromAmount !== bridge.minAmount.toString() || be.toAmount !== quoted.toString() || be.toAmountMin !== quotedMin.toString() ||
        bridgeAddress(be.approvalAddress) !== BRIDGE_DIAMOND || !Array.isArray(be.feeCosts) || be.feeCosts.length !== 3 ||
        canonicalJson(be.feeCosts) !== canonicalJson(fees.slice(1)))
        fail("included_steps");
    return { kind: "offline_near_tron_source_inspection", executionAdmitted: false, bridgeCompletion: false,
        destinationBinding: "tron_account_payload_matches", sourceChainId: 8453, apiDestinationChainId: BASE_TRON_USDT_CANDIDATE.toChainId,
        facetDestinationChainId: FACET_TRON_ID.toString(), sourceToken: SOURCE_TOKEN,
        quotedDestinationToken: BASE_TRON_USDT_CANDIDATE.toToken, quotedTronRecipient: recipient,
        facetNonEvmReceiver: near.nonEVMReceiver, expectedTronAddressWord: expectedWord,
        transactionTarget: BRIDGE_DIAMOND, approvalSpender: BRIDGE_DIAMOND, sourceAmountAtomic: source.toString(),
        feeAmountAtomic: fee.toString(), bridgeAmountAtomic: bridge.minAmount.toString(),
        offchainMinimumOutputAtomic: quotedMin.toString(), facetMinimumOutputAtomic: near.minAmountOut.toString(),
        depositAddress: near.depositAddress, quoteId: near.quoteId, deadline: near.deadline.toString(),
        calldataSha256: sha256(Buffer.from(data.slice(2), "hex")) };
}
//# sourceMappingURL=near-tron-offline.js.map