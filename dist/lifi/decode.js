import { decodeFunctionData, encodeFunctionData, getAddress } from "viem";
import { sha256 } from "../canonical.js";
import { ACROSS_SELECTOR, acrossBridgeAbi, FEE_FORWARDER, FEE_FORWARDER_SELECTOR, FEE_RECIPIENT, feeForwarderAbi, STARGATE_SELECTOR, stargateBridgeAbi } from "./abi.js";
import { validateBridgeRequest } from "./asset-registry.js";
import { BRIDGE_DIAMOND, BRIDGE_MAX_CALLDATA_BYTES, BRIDGE_MAX_GAS, BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD, bridgeAddress, bridgeFailure, bridgeHex, bridgeUint } from "./validation.js";
export function decodeBridgeCall(materialization) {
    const request = validateBridgeRequest(materialization.request);
    const tx = materialization.transaction;
    const data = bridgeHex(tx.data, BRIDGE_MAX_CALLDATA_BYTES);
    const sourceAmount = bridgeUint(request.amountAtomic, true);
    const quotedOutput = bridgeUint(materialization.quotedOutputAtomic, true);
    const minimumOutput = bridgeUint(materialization.minimumOutputAtomic, true);
    const value = bridgeUint(tx.valueAtomic, false);
    const gas = bridgeUint(tx.gasLimitAtomic, true);
    if (gas > BRIDGE_MAX_GAS || tx.chainId !== request.fromChainId || tx.from !== materialization.sender ||
        bridgeAddress(tx.from) !== tx.from || tx.to !== BRIDGE_DIAMOND || materialization.approvalAddress !== BRIDGE_DIAMOND ||
        materialization.sender !== bridgeAddress(materialization.sender) || materialization.sender === BRIDGE_ZERO_ADDRESS ||
        value > BigInt(request.maxNativeDebitWei))
        fail("transaction_envelope");
    if (quotedOutput < minimumOutput || minimumOutput < BigInt(request.minOutputAtomic) || sourceAmount < quotedOutput ||
        sourceAmount - minimumOutput > BigInt(request.maxRouteFeeAtomic) ||
        (quotedOutput - minimumOutput) * 10000n > quotedOutput * BigInt(request.slippageBps))
        fail("output_economics");
    const selector = data.slice(0, 10);
    try {
        if (materialization.tool === "across" && selector === ACROSS_SELECTOR) {
            const decoded = decodeFunctionData({ abi: acrossBridgeAbi, data });
            if (decoded.functionName !== "swapAndStartBridgeTokensViaAcrossV4" || canonicalData(acrossBridgeAbi, decoded.functionName, decoded.args) !== data)
                fail("noncanonical_calldata");
            const [bridgeData, swaps, across] = decoded.args;
            return decodeAcross(materialization, bridgeData, swaps, across, data, sourceAmount, minimumOutput, value);
        }
        if (materialization.tool === "stargateV2" && selector === STARGATE_SELECTOR) {
            const decoded = decodeFunctionData({ abi: stargateBridgeAbi, data });
            if (decoded.functionName !== "swapAndStartBridgeTokensViaStargate" || canonicalData(stargateBridgeAbi, decoded.functionName, decoded.args) !== data)
                fail("noncanonical_calldata");
            const [bridgeData, swaps, stargate] = decoded.args;
            return decodeStargate(materialization, bridgeData, swaps, stargate, data, sourceAmount, minimumOutput, value);
        }
    }
    catch (error) {
        if (error instanceof Error && error.name === "ApnError")
            throw error;
        fail("ABI_decode");
    }
    return fail("tool_selector");
}
function decodeAcross(m, bridge, swaps, across, data, sourceAmount, minimum, value) {
    const common = decodeCommon(m, bridge, swaps, sourceAmount);
    const receiverWord = addressWord(m.request.recipient), senderWord = addressWord(m.sender);
    const inputWord = addressWord(m.request.fromToken), outputWord = addressWord(m.request.toToken);
    if (value !== 0n || across.receiverAddress.toLowerCase() !== receiverWord || across.refundAddress.toLowerCase() !== senderWord ||
        across.sendingAssetId.toLowerCase() !== inputWord || across.receivingAssetId.toLowerCase() !== outputWord ||
        across.exclusiveRelayer.toLowerCase() !== BRIDGE_ZERO_WORD || across.exclusivityParameter !== 0 || across.message !== "0x" ||
        across.outputAmountMultiplier <= 0n || across.outputAmountMultiplier > 1000000000000000000n ||
        across.outputAmount !== bridge.minAmount * across.outputAmountMultiplier / 1000000000000000000n ||
        across.outputAmount !== minimum || across.quoteTimestamp >= across.fillDeadline)
        fail("across_semantics");
    validateFeeRows(m, common.fee, value, "across");
    return result(m, data, ACROSS_SELECTOR, bridge, common.fee, {
        kind: "across", receiverAddress: bridgeHex(across.receiverAddress, 32, 32), refundAddress: bridgeHex(across.refundAddress, 32, 32),
        sendingAssetId: bridgeHex(across.sendingAssetId, 32, 32), receivingAssetId: bridgeHex(across.receivingAssetId, 32, 32),
        outputAmountAtomic: across.outputAmount.toString(), outputAmountMultiplier: across.outputAmountMultiplier.toString(),
        exclusiveRelayer: bridgeHex(across.exclusiveRelayer, 32, 32), quoteTimestamp: String(across.quoteTimestamp),
        fillDeadline: String(across.fillDeadline), exclusivityParameter: String(across.exclusivityParameter), message: "0x",
    }, common.bridgeAmount, "0");
}
function decodeStargate(m, bridge, swaps, stargate, data, sourceAmount, minimum, value) {
    const common = decodeCommon(m, bridge, swaps, sourceAmount);
    const expectedEid = destinationEid(m.request.toChainId);
    const p = stargate.sendParams;
    if (stargate.assetId !== 1 || p.dstEid !== expectedEid || p.to.toLowerCase() !== addressWord(m.request.recipient) ||
        p.amountLD !== bridge.minAmount || p.minAmountLD !== minimum || p.extraOptions !== "0x" || p.composeMsg !== "0x" || p.oftCmd !== "0x" ||
        stargate.fee.nativeFee !== value || value === 0n || stargate.fee.lzTokenFee !== 0n || stargate.refundAddress !== m.sender)
        fail("stargate_taxi_semantics");
    validateFeeRows(m, common.fee, value, "stargateV2");
    return result(m, data, STARGATE_SELECTOR, bridge, common.fee, {
        kind: "stargateV2", assetId: 1, dstEid: p.dstEid, receiverAddress: bridgeHex(p.to, 32, 32),
        amountLD: p.amountLD.toString(), minAmountLD: p.minAmountLD.toString(), nativeFee: value.toString(), lzTokenFee: "0",
        refundAddress: stargate.refundAddress, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x",
    }, common.bridgeAmount, value.toString());
}
function decodeCommon(m, bridge, swaps, sourceAmount) {
    const request = m.request;
    if (bridge.transactionId.toLowerCase() === BRIDGE_ZERO_WORD || bridge.bridge !== m.tool || bridge.integrator !== "lifi-api" ||
        bridge.referrer !== BRIDGE_ZERO_ADDRESS || bridge.sendingAssetId !== request.fromToken || bridge.receiver !== request.recipient ||
        bridge.destinationChainId !== BigInt(request.toChainId) || !bridge.hasSourceSwaps || bridge.hasDestinationCall || bridge.minAmount <= 0n || bridge.minAmount >= sourceAmount || swaps.length !== 1)
        fail("bridge_data");
    const swap = swaps[0];
    if (swap.callTo !== FEE_FORWARDER || swap.approveTo !== FEE_FORWARDER || swap.sendingAssetId !== request.fromToken ||
        swap.receivingAssetId !== request.fromToken || swap.fromAmount !== sourceAmount || !swap.requiresDeposit)
        fail("fee_swap");
    const callData = bridgeHex(swap.callData);
    if (callData.slice(0, 10) !== FEE_FORWARDER_SELECTOR)
        fail("fee_selector");
    let inner;
    try {
        inner = decodeFunctionData({ abi: feeForwarderAbi, data: callData });
    }
    catch {
        return fail("fee_ABI");
    }
    if (inner.functionName !== "forwardERC20Fees" || canonicalData(feeForwarderAbi, inner.functionName, inner.args) !== callData)
        fail("fee_noncanonical");
    const [token, distributions] = inner.args;
    const fee = sourceAmount - bridge.minAmount;
    if (token !== request.fromToken || distributions.length !== 1 || distributions[0].recipient !== FEE_RECIPIENT || distributions[0].amount !== fee || fee <= 0n)
        fail("fee_distribution");
    return { fee, bridgeAmount: bridge.minAmount };
}
function validateFeeRows(m, forwardedFee, value, tool) {
    let included = 0n, fixed = 0, native = 0;
    for (const fee of m.feeCosts) {
        const amount = bridgeUint(fee.amountAtomic, false);
        if (fee.included) {
            if (fee.chainId !== m.request.fromChainId && fee.chainId !== m.request.toChainId)
                fail("included_fee_asset");
            if (fee.asset !== (fee.chainId === m.request.fromChainId ? m.request.fromToken : m.request.toToken))
                fail("included_fee_asset");
            included += amount;
            if (fee.name === "LIFI Fixed Fee" && fee.chainId === m.request.fromChainId && fee.asset === m.request.fromToken && amount === forwardedFee)
                fixed += 1;
        }
        else {
            if (tool !== "stargateV2" || fee.name !== "LayerZero native fee" || fee.chainId !== m.request.fromChainId || fee.asset !== "native" || amount !== value)
                fail("native_fee_row");
            native += 1;
        }
    }
    if (fixed !== 1 || included + BigInt(m.quotedOutputAtomic) > BigInt(m.request.amountAtomic) || (tool === "across" ? native !== 0 : native !== 1))
        fail("fee_reconciliation");
}
function result(m, data, selector, bridge, fee, protocol, bridgeAmount, sourceValueAtomic) {
    return {
        tool: m.tool, selector, transactionId: bridgeHex(bridge.transactionId, 32, 32), bridgeName: m.tool,
        integrator: "lifi-api", referrer: BRIDGE_ZERO_ADDRESS, sender: m.sender, recipient: m.request.recipient,
        sourceChainId: m.request.fromChainId, destinationChainId: m.request.toChainId, sourceToken: m.request.fromToken,
        destinationToken: m.request.toToken, sourceAmountAtomic: m.request.amountAtomic, bridgeAmountAtomic: bridgeAmount.toString(),
        feeAmountAtomic: fee.toString(), feeRecipient: FEE_RECIPIENT, minimumOutputAtomic: m.minimumOutputAtomic,
        sourceValueAtomic, dataHash: sha256(Buffer.from(data.slice(2), "hex")), protocol,
    };
}
function canonicalData(abi, functionName, args) {
    return encodeFunctionData({ abi, functionName: functionName, args: args }).toLowerCase();
}
function addressWord(address) { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`; }
function destinationEid(chainId) { if (chainId === 1)
    return 30101; if (chainId === 8453)
    return 30184; if (chainId === 42161)
    return 30110; return fail("destination_EID"); }
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", reason); }
//# sourceMappingURL=decode.js.map