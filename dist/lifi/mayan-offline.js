/**
 * Offline inspection of one LI.FI Base USDC -> Solana USDC Mayan MCTP quote shape.
 * This module is deliberately not imported by route admission, preparation or execution.
 * ABI: lifinance/contracts@4b4b8138a6f12e8c32ad72040fae5f1a763e3fc6.
 */
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from "viem";
import { canonicalJson, sha256 } from "../canonical.js";
import { BASE_SOLANA_USDC_CANDIDATE } from "./discovery-candidates.js";
import { FEE_FORWARDER, FEE_FORWARDER_SELECTOR, FEE_RECIPIENT, feeForwarderAbi } from "./abi.js";
import { BRIDGE_DIAMOND, BRIDGE_MAX_CALLDATA_BYTES, BRIDGE_ZERO_ADDRESS, bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint } from "./validation.js";
const SELECTOR = "0x80c65808";
const MAYAN_CIRCLE_SELECTOR = "0x2072197f";
const MAYAN_CIRCLE = getAddress("0x875d6d37ec55c8cf220b9e5080717549d8aa8eca");
/** Opaque uint64 in the captured synthetic quote; this is a fixture pin, not a semantic fee claim. */
const CAPTURED_CIRCLE_ARG2 = 1647869n;
const NON_EVM_RECEIVER = getAddress("0x11f111f111f111f111f111f111f111f111f111f1");
const SOURCE_TOKEN = getAddress(BASE_SOLANA_USDC_CANDIDATE.fromToken);
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BRIDGE_DATA = "(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)";
const SWAP_DATA = "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[]";
const MAYAN_DATA = "(bytes32 nonEVMReceiver,address mayanProtocol,bytes protocolData,address swapProtocol,bytes swapData,address middleToken,uint256 minMiddleAmount,address refundRecipient,uint256 mayanAmountIn)";
const MAYAN_ABI = parseAbi([`function swapAndStartBridgeTokensViaMayan(${BRIDGE_DATA} bridgeData,${SWAP_DATA} swapData,${MAYAN_DATA} mayanData) payable`]);
const CIRCLE_ABI = parseAbi(["function bridgeWithFee(address tokenIn,uint256 amountIn,uint64 arg2,uint64 arg3,bytes32 recipient,uint32 destinationDomain,uint8 arg6,bytes arg7)"]);
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `mayan_offline_${reason}`); }
function field(record, name) { return record[name]; }
function equalAddress(value, expected) { return bridgeAddress(value) === expected; }
function tokenIdentity(value, chainId, address) {
    const token = bridgeRecord(value);
    return token.chainId === chainId && token.decimals === 6 && token.symbol === "USDC" &&
        (chainId === 8453 ? equalAddress(token.address, SOURCE_TOKEN) : token.address === address);
}
function canonical(abi, name, args, original) {
    return encodeFunctionData({ abi, functionName: name, args: args }).toLowerCase() === original.toLowerCase();
}
function base58Bytes(value) {
    if (typeof value !== "string" || value.length < 32 || value.length > 44)
        fail("solana_address_shape");
    let number = 0n;
    for (const character of value) {
        const digit = ALPHABET.indexOf(character);
        if (digit < 0)
            fail("solana_address_base58");
        number = number * 58n + BigInt(digit);
    }
    const bytes = new Uint8Array(32);
    for (let index = 31; index >= 0; index--) {
        bytes[index] = Number(number & 255n);
        number >>= 8n;
    }
    if (number !== 0n)
        fail("solana_address_width");
    let encoded = "", remaining = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
    while (remaining > 0n) {
        encoded = ALPHABET[Number(remaining % 58n)] + encoded;
        remaining /= 58n;
    }
    for (const byte of bytes) {
        if (byte !== 0)
            break;
        encoded = `1${encoded}`;
    }
    if (encoded !== value)
        fail("solana_address_noncanonical");
    return bytes;
}
export function decodeMayanBaseSolanaQuoteOffline(quoteValue, binding) {
    const quote = bridgeRecord(quoteValue);
    const action = bridgeRecord(field(quote, "action"));
    const estimate = bridgeRecord(field(quote, "estimate"));
    const tx = bridgeRecord(field(quote, "transactionRequest"));
    const sender = bridgeAddress(binding.sender);
    const sourceAmount = bridgeUint(binding.sourceAmountAtomic, true);
    const maxFee = bridgeUint(binding.maxFeeAtomic, false);
    const quotedOutput = bridgeUint(field(estimate, "toAmount"), true);
    const minimumOutput = bridgeUint(field(estimate, "toAmountMin"), true);
    if (quote.tool !== "mayanMCTP" || quote.type !== "lifi" || quote.integrator !== "lifi-api" ||
        action.fromChainId !== 8453 || action.toChainId !== 1151111081099710 || action.slippage !== 0.005 ||
        !tokenIdentity(action.fromToken, 8453, SOURCE_TOKEN) || !tokenIdentity(action.toToken, 1151111081099710, BASE_SOLANA_USDC_CANDIDATE.toToken) ||
        action.fromAddress !== sender || action.toAddress !== binding.solanaRecipient || action.fromAmount !== binding.sourceAmountAtomic ||
        estimate.fromAmount !== binding.sourceAmountAtomic ||
        !equalAddress(estimate.approvalAddress, BRIDGE_DIAMOND) || tx.chainId !== 8453 || !equalAddress(tx.from, sender) ||
        !equalAddress(tx.to, BRIDGE_DIAMOND) || tx.value !== "0x0" || !/^0x[0-9a-f]+$/u.test(String(tx.gasLimit)) ||
        minimumOutput > quotedOutput || quotedOutput > sourceAmount)
        fail("quote_binding");
    const gasLimit = BigInt(tx.gasLimit);
    if (gasLimit <= 0n || gasLimit > 5000000n)
        fail("gas_bound");
    const receiver = base58Bytes(binding.solanaRecipient);
    const data = bridgeHex(tx.data, BRIDGE_MAX_CALLDATA_BYTES);
    if (data.slice(0, 10) !== SELECTOR)
        fail("source_selector");
    let bridge, swaps, mayan;
    try {
        const decoded = decodeFunctionData({ abi: MAYAN_ABI, data });
        if (decoded.functionName !== "swapAndStartBridgeTokensViaMayan" || !canonical(MAYAN_ABI, decoded.functionName, decoded.args, data))
            fail("source_noncanonical");
        [bridge, swaps, mayan] = decoded.args;
    }
    catch (error) {
        if (error instanceof Error && error.name === "ApnError")
            throw error;
        return fail("source_abi");
    }
    if (bridge.transactionId === `0x${"0".repeat(64)}` || quote.transactionId !== bridge.transactionId ||
        bridge.bridge !== "mayanMCTP" || bridge.integrator !== "lifi-api" ||
        bridge.referrer !== BRIDGE_ZERO_ADDRESS || bridge.sendingAssetId !== SOURCE_TOKEN || bridge.receiver !== NON_EVM_RECEIVER ||
        bridge.destinationChainId !== 1151111081099710n || !bridge.hasSourceSwaps || bridge.hasDestinationCall ||
        bridge.minAmount <= 0n || bridge.minAmount >= sourceAmount || swaps.length !== 1)
        fail("bridge_data");
    const swap = swaps[0];
    if (swap.callTo !== FEE_FORWARDER || swap.approveTo !== FEE_FORWARDER || swap.sendingAssetId !== SOURCE_TOKEN ||
        swap.receivingAssetId !== SOURCE_TOKEN || swap.fromAmount !== sourceAmount || !swap.requiresDeposit ||
        swap.callData.slice(0, 10) !== FEE_FORWARDER_SELECTOR)
        fail("fee_step");
    const fee = sourceAmount - bridge.minAmount;
    if (fee <= 0n || fee > maxFee)
        fail("fee_cap");
    try {
        const decoded = decodeFunctionData({ abi: feeForwarderAbi, data: swap.callData });
        if (decoded.functionName !== "forwardERC20Fees" || !canonical(feeForwarderAbi, decoded.functionName, decoded.args, swap.callData))
            fail("fee_noncanonical");
        const [token, distributions] = decoded.args;
        if (token !== SOURCE_TOKEN || distributions.length !== 1 || distributions[0].recipient !== FEE_RECIPIENT || distributions[0].amount !== fee)
            fail("fee_distribution");
    }
    catch (error) {
        if (error instanceof Error && error.name === "ApnError")
            throw error;
        return fail("fee_abi");
    }
    const quotedFees = field(estimate, "feeCosts");
    if (!Array.isArray(quotedFees) || quotedFees.length !== 1)
        fail("fee_rows");
    const feeRow = bridgeRecord(quotedFees[0]);
    const feeSplit = bridgeRecord(feeRow.feeSplit);
    if (!Array.isArray(feeSplit.recipients) || feeSplit.recipients.length !== 1)
        fail("fee_rows");
    const feeRecipient = bridgeRecord(feeSplit.recipients[0]);
    if (feeRow.name !== "LIFI Fixed Fee" || feeRow.included !== true || feeRow.amount !== fee.toString() ||
        !tokenIdentity(feeRow.token, 8453, SOURCE_TOKEN) || feeSplit.lifiFee !== fee.toString() || feeSplit.integratorFee !== "0" ||
        feeRecipient.name !== "lifi" || feeRecipient.type !== "FIXED" || feeRecipient.fee !== fee.toString())
        fail("fee_rows");
    if (mayan.nonEVMReceiver.toLowerCase() !== `0x${Buffer.from(receiver).toString("hex")}` || mayan.mayanProtocol !== MAYAN_CIRCLE ||
        mayan.swapProtocol !== BRIDGE_ZERO_ADDRESS || mayan.swapData !== "0x" || mayan.middleToken !== BRIDGE_ZERO_ADDRESS ||
        mayan.minMiddleAmount !== 0n || mayan.refundRecipient !== sender || mayan.mayanAmountIn !== bridge.minAmount ||
        mayan.protocolData.slice(0, 10) !== MAYAN_CIRCLE_SELECTOR)
        fail("mayan_data");
    let protocolArg2, destinationDomain;
    try {
        const decoded = decodeFunctionData({ abi: CIRCLE_ABI, data: mayan.protocolData });
        if (decoded.functionName !== "bridgeWithFee" || !canonical(CIRCLE_ABI, decoded.functionName, decoded.args, mayan.protocolData))
            fail("mayan_protocol_noncanonical");
        const [token, amount, arg2, arg3, recipient, domain, arg6, arg7] = decoded.args;
        if (token !== SOURCE_TOKEN || amount !== bridge.minAmount || recipient.toLowerCase() !== mayan.nonEVMReceiver.toLowerCase() ||
            domain !== 5 || arg6 !== 1 || arg7 !== "0x" || arg3 !== 0n || arg2 !== CAPTURED_CIRCLE_ARG2)
            fail("mayan_protocol");
        protocolArg2 = arg2;
        destinationDomain = domain;
    }
    catch (error) {
        if (error instanceof Error && error.name === "ApnError")
            throw error;
        return fail("mayan_protocol_abi");
    }
    const steps = quote.includedSteps;
    if (!Array.isArray(steps) || steps.length !== 2)
        fail("included_steps");
    const feeStep = bridgeRecord(steps[0]);
    const bridgeStep = bridgeRecord(steps[1]);
    const feeAction = bridgeRecord(feeStep.action);
    const bridgeAction = bridgeRecord(bridgeStep.action);
    const feeEstimate = bridgeRecord(feeStep.estimate);
    const bridgeEstimate = bridgeRecord(bridgeStep.estimate);
    if (feeStep.type !== "protocol" || feeStep.tool !== "feeCollection" || bridgeStep.type !== "cross" || bridgeStep.tool !== "mayanMCTP" ||
        feeAction.fromChainId !== 8453 || feeAction.toChainId !== 8453 || feeAction.fromAddress !== BRIDGE_DIAMOND || feeAction.toAddress !== BRIDGE_DIAMOND ||
        feeAction.fromAmount !== sourceAmount.toString() || feeAction.slippage !== action.slippage ||
        !tokenIdentity(feeAction.fromToken, 8453, SOURCE_TOKEN) || !tokenIdentity(feeAction.toToken, 8453, SOURCE_TOKEN) ||
        feeEstimate.fromAmount !== sourceAmount.toString() || feeEstimate.toAmount !== bridge.minAmount.toString() ||
        feeEstimate.toAmountMin !== bridge.minAmount.toString() || !equalAddress(feeEstimate.approvalAddress, FEE_FORWARDER) ||
        !Array.isArray(feeEstimate.feeCosts) || feeEstimate.feeCosts.length !== 1 ||
        canonicalJson(feeEstimate.feeCosts[0]) !== canonicalJson(feeRow) ||
        bridgeAction.fromChainId !== 8453 || bridgeAction.toChainId !== 1151111081099710 || bridgeAction.fromAddress !== BRIDGE_DIAMOND ||
        bridgeAction.toAddress !== binding.solanaRecipient || bridgeAction.fromAmount !== bridge.minAmount.toString() ||
        bridgeAction.slippage !== action.slippage || !tokenIdentity(bridgeAction.fromToken, 8453, SOURCE_TOKEN) ||
        !tokenIdentity(bridgeAction.toToken, 1151111081099710, BASE_SOLANA_USDC_CANDIDATE.toToken) ||
        bridgeEstimate.fromAmount !== bridge.minAmount.toString() || bridgeEstimate.toAmount !== quotedOutput.toString() ||
        bridgeEstimate.toAmountMin !== minimumOutput.toString() || bridgeEstimate.approvalAddress !== binding.solanaRecipient ||
        !Array.isArray(bridgeEstimate.feeCosts) || bridgeEstimate.feeCosts.length !== 0)
        fail("included_steps");
    return {
        kind: "offline_mayan_mctp_source_inspection", bridgeCompletion: false, sourceChainId: 8453, destinationChainId: 1151111081099710,
        sourceToken: SOURCE_TOKEN, destinationToken: BASE_SOLANA_USDC_CANDIDATE.toToken, sender, solanaRecipient: binding.solanaRecipient,
        approvalSpender: BRIDGE_DIAMOND, transactionTarget: BRIDGE_DIAMOND, transactionId: bridge.transactionId,
        sourceAmountAtomic: sourceAmount.toString(), feeAmountAtomic: fee.toString(), bridgeAmountAtomic: bridge.minAmount.toString(),
        offchainToAmountMinAtomic: minimumOutput.toString(), mayanProtocol: MAYAN_CIRCLE, mayanProtocolArg2: protocolArg2.toString(),
        mayanDestinationDomain: destinationDomain, refundRecipient: mayan.refundRecipient, calldataSha256: sha256(Buffer.from(data.slice(2), "hex")),
    };
}
//# sourceMappingURL=mayan-offline.js.map