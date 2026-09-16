import { decodeEventLog } from "viem";
import { canonicalJson, sha256 } from "../canonical.js";
import { bridgeEventsAbi, EVENT_TOPICS, FEE_FORWARDER, FEE_RECIPIENT } from "./abi.js";
import { decodeBridgeCall } from "./decode.js";
import { bridgeEndpointId, bridgeProtocolEmitter } from "./deployments.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD, bridgeAddress, bridgeFailure, bridgeHash, bridgeHex, bridgeSame, bridgeUint } from "./validation.js";
export function bridgeSourceProof(materialization, decoded, receipt) {
    const canonical = decodeBridgeCall(materialization);
    if (!bridgeSame(canonical, decoded) || receipt.chainId !== decoded.sourceChainId)
        fail("source_binding");
    validateReceipt(receipt);
    validateCommonSourceEvents(decoded, receipt);
    validateSourceTransfers(decoded, receipt);
    const correlation = decoded.tool === "across" ? acrossSource(decoded, receipt) : stargateSource(decoded, receipt);
    return {
        tool: decoded.tool, chainId: receipt.chainId, transactionHash: receipt.transactionHash,
        blockNumberAtomic: receipt.blockNumberAtomic, blockHash: receipt.blockHash,
        sourceAmountAtomic: decoded.sourceAmountAtomic, bridgeAmountAtomic: decoded.bridgeAmountAtomic,
        feeForwardedAtomic: decoded.feeAmountAtomic, logsHash: logsHash(receipt.logs), correlation,
    };
}
export function bridgeDestinationProof(source, materialization, decoded, receipt) {
    const canonical = decodeBridgeCall(materialization);
    if (!bridgeSame(canonical, decoded) || source.tool !== decoded.tool || source.chainId !== decoded.sourceChainId ||
        source.sourceAmountAtomic !== decoded.sourceAmountAtomic || source.bridgeAmountAtomic !== decoded.bridgeAmountAtomic ||
        source.feeForwardedAtomic !== decoded.feeAmountAtomic || receipt.chainId !== decoded.destinationChainId)
        fail("destination_binding");
    validateStoredSource(source, decoded);
    validateReceipt(receipt);
    if (decoded.tool === "across")
        return acrossDestination(source, decoded, receipt);
    return stargateDestination(source, decoded, receipt);
}
function validateStoredSource(source, decoded) {
    if (bridgeHex(source.transactionHash, 32, 32, "APN_STATE_CORRUPT") === BRIDGE_ZERO_WORD ||
        bridgeHex(source.blockHash, 32, 32, "APN_STATE_CORRUPT") === BRIDGE_ZERO_WORD)
        fail("stored_source_identity");
    bridgeUint(source.blockNumberAtomic, true, "APN_STATE_CORRUPT");
    bridgeHash(source.logsHash);
    if (source.correlation.kind === "across" && decoded.protocol.kind === "across") {
        const c = source.correlation, p = decoded.protocol;
        bridgeUint(c.depositId, false, "APN_STATE_CORRUPT");
        const inputToken = bridgeHex(c.inputToken, 32, 32, "APN_STATE_CORRUPT");
        const outputToken = bridgeHex(c.outputToken, 32, 32, "APN_STATE_CORRUPT");
        const depositor = bridgeHex(c.depositor, 32, 32, "APN_STATE_CORRUPT");
        const recipient = bridgeHex(c.recipient, 32, 32, "APN_STATE_CORRUPT");
        const exclusiveRelayer = bridgeHex(c.exclusiveRelayer, 32, 32, "APN_STATE_CORRUPT");
        bridgeUint(c.inputAmountAtomic, true, "APN_STATE_CORRUPT");
        bridgeUint(c.outputAmountAtomic, true, "APN_STATE_CORRUPT");
        bridgeUint(c.quoteTimestamp, true, "APN_STATE_CORRUPT");
        bridgeUint(c.fillDeadline, true, "APN_STATE_CORRUPT");
        bridgeUint(c.exclusivityDeadline, false, "APN_STATE_CORRUPT");
        if (c.originChainId !== decoded.sourceChainId || c.destinationChainId !== decoded.destinationChainId ||
            inputToken !== p.sendingAssetId || outputToken !== p.receivingAssetId || c.inputAmountAtomic !== decoded.bridgeAmountAtomic || c.outputAmountAtomic !== p.outputAmountAtomic ||
            depositor !== p.refundAddress || recipient !== p.receiverAddress || exclusiveRelayer !== p.exclusiveRelayer ||
            c.quoteTimestamp !== p.quoteTimestamp || c.fillDeadline !== p.fillDeadline || c.exclusivityDeadline !== "0" || c.message !== "0x")
            fail("stored_across_correlation");
        return;
    }
    if (source.correlation.kind === "stargateV2" && decoded.protocol.kind === "stargateV2") {
        const c = source.correlation;
        const guid = bridgeHex(c.guid, 32, 32, "APN_STATE_CORRUPT");
        const sender = bridgeAddress(c.sender, "APN_STATE_CORRUPT");
        const recipient = bridgeAddress(c.recipient, "APN_STATE_CORRUPT");
        bridgeUint(c.amountSentAtomic, true, "APN_STATE_CORRUPT");
        const received = bridgeUint(c.amountReceivedAtomic, true, "APN_STATE_CORRUPT");
        if (guid === BRIDGE_ZERO_WORD || c.sourceEid !== bridgeEndpointId(decoded.sourceChainId) || c.destinationEid !== decoded.protocol.dstEid ||
            sender !== decoded.sender || recipient !== decoded.recipient || c.amountSentAtomic !== decoded.bridgeAmountAtomic ||
            received < BigInt(decoded.minimumOutputAtomic))
            fail("stored_stargate_correlation");
        return;
    }
    fail("stored_correlation_kind");
}
/** The destination token selects the Stargate pool emitter; the Across spoke pool is asset independent. */
export function destinationEventFilter(source, destinationToken) {
    if (source.correlation.kind === "across") {
        const c = source.correlation;
        return { address: bridgeProtocolEmitter(c.destinationChainId, "across", destinationToken), topics: [EVENT_TOPICS.filledRelay, uintWord(c.originChainId), uintWord(c.depositId)] };
    }
    const c = source.correlation;
    const destination = chainForEid(c.destinationEid);
    return { address: bridgeProtocolEmitter(destination, "stargateV2", destinationToken), topics: [EVENT_TOPICS.oftReceived, bridgeHex(c.guid, 32, 32), addressWord(c.recipient)] };
}
function validateCommonSourceEvents(decoded, receipt) {
    const lifi = oneEvent(receipt, BRIDGE_DIAMOND, EVENT_TOPICS.lifiTransferStarted, "LiFiTransferStarted");
    const b = lifi.bridgeData;
    if (b.transactionId.toLowerCase() !== decoded.transactionId || b.bridge !== decoded.bridgeName || b.integrator !== decoded.integrator ||
        b.referrer !== decoded.referrer || b.sendingAssetId !== decoded.sourceToken || b.receiver !== decoded.recipient ||
        b.minAmount.toString() !== decoded.bridgeAmountAtomic || b.destinationChainId !== BigInt(decoded.destinationChainId) ||
        !b.hasSourceSwaps || b.hasDestinationCall)
        fail("LiFiTransferStarted");
    const fees = oneEvent(receipt, FEE_FORWARDER, EVENT_TOPICS.feesForwarded, "FeesForwarded");
    if (fees.token !== decoded.sourceToken || fees.distributions.length !== 1 || fees.distributions[0].recipient !== FEE_RECIPIENT ||
        fees.distributions[0].amount.toString() !== decoded.feeAmountAtomic)
        fail("FeesForwarded");
}
function validateSourceTransfers(decoded, receipt) {
    const transfers = events(receipt, decoded.sourceToken, EVENT_TOPICS.transfer, "Transfer");
    const fromSender = transfers.filter((x) => x.from === decoded.sender);
    const fromDiamond = transfers.filter((x) => x.from === BRIDGE_DIAMOND);
    const emitter = bridgeProtocolEmitter(decoded.sourceChainId, decoded.tool, decoded.sourceToken);
    if (transfers.length !== 3 || fromSender.length !== 1 || fromSender[0].to !== BRIDGE_DIAMOND || fromSender[0].value.toString() !== decoded.sourceAmountAtomic ||
        fromDiamond.length !== 2 || !fromDiamond.some((x) => x.to === FEE_RECIPIENT && x.value.toString() === decoded.feeAmountAtomic) ||
        !fromDiamond.some((x) => x.to === emitter && x.value.toString() === decoded.bridgeAmountAtomic))
        fail("source_token_movements");
}
function acrossSource(decoded, receipt) {
    if (decoded.protocol.kind !== "across")
        return fail("across_shape");
    const p = decoded.protocol;
    const emitter = bridgeProtocolEmitter(decoded.sourceChainId, "across", decoded.sourceToken);
    const e = oneEvent(receipt, emitter, EVENT_TOPICS.fundsDeposited, "FundsDeposited");
    if (e.inputToken.toLowerCase() !== p.sendingAssetId || e.outputToken.toLowerCase() !== p.receivingAssetId ||
        e.inputAmount.toString() !== decoded.bridgeAmountAtomic || e.outputAmount.toString() !== p.outputAmountAtomic ||
        e.destinationChainId !== BigInt(decoded.destinationChainId) || e.quoteTimestamp.toString() !== p.quoteTimestamp ||
        e.fillDeadline.toString() !== p.fillDeadline || e.exclusivityDeadline !== 0 || e.depositor.toLowerCase() !== p.refundAddress ||
        e.recipient.toLowerCase() !== p.receiverAddress || e.exclusiveRelayer.toLowerCase() !== p.exclusiveRelayer || e.message !== "0x")
        fail("FundsDeposited");
    return {
        kind: "across", depositId: e.depositId.toString(), originChainId: decoded.sourceChainId, destinationChainId: decoded.destinationChainId,
        inputToken: bridgeHex(e.inputToken, 32, 32), outputToken: bridgeHex(e.outputToken, 32, 32), inputAmountAtomic: e.inputAmount.toString(),
        outputAmountAtomic: e.outputAmount.toString(), depositor: bridgeHex(e.depositor, 32, 32), recipient: bridgeHex(e.recipient, 32, 32),
        exclusiveRelayer: bridgeHex(e.exclusiveRelayer, 32, 32), quoteTimestamp: String(e.quoteTimestamp), fillDeadline: String(e.fillDeadline),
        exclusivityDeadline: String(e.exclusivityDeadline), message: "0x",
    };
}
function stargateSource(decoded, receipt) {
    if (decoded.protocol.kind !== "stargateV2")
        return fail("stargate_shape");
    const emitter = bridgeProtocolEmitter(decoded.sourceChainId, "stargateV2", decoded.sourceToken);
    const e = oneEvent(receipt, emitter, EVENT_TOPICS.oftSent, "OFTSent");
    if (e.guid.toLowerCase() === BRIDGE_ZERO_WORD || e.dstEid !== decoded.protocol.dstEid || e.fromAddress !== BRIDGE_DIAMOND ||
        e.amountSentLD.toString() !== decoded.bridgeAmountAtomic || e.amountReceivedLD < BigInt(decoded.minimumOutputAtomic))
        fail("OFTSent");
    return {
        kind: "stargateV2", guid: bridgeHex(e.guid, 32, 32), sourceEid: bridgeEndpointId(decoded.sourceChainId),
        destinationEid: decoded.protocol.dstEid, sender: decoded.sender, recipient: decoded.recipient,
        amountSentAtomic: e.amountSentLD.toString(), amountReceivedAtomic: e.amountReceivedLD.toString(),
    };
}
function acrossDestination(source, decoded, receipt) {
    if (source.correlation.kind !== "across")
        return fail("across_correlation");
    const c = source.correlation;
    const emitter = bridgeProtocolEmitter(decoded.destinationChainId, "across", decoded.destinationToken);
    const e = oneEvent(receipt, emitter, EVENT_TOPICS.filledRelay, "FilledRelay");
    const info = e.relayExecutionInfo;
    if (e.originChainId !== BigInt(c.originChainId) || e.depositId.toString() !== c.depositId || e.inputToken.toLowerCase() !== c.inputToken ||
        e.outputToken.toLowerCase() !== c.outputToken || e.inputAmount.toString() !== c.inputAmountAtomic || e.outputAmount.toString() !== c.outputAmountAtomic ||
        e.fillDeadline.toString() !== c.fillDeadline || e.exclusivityDeadline.toString() !== c.exclusivityDeadline ||
        e.exclusiveRelayer.toLowerCase() !== c.exclusiveRelayer || e.depositor.toLowerCase() !== c.depositor || e.recipient.toLowerCase() !== c.recipient ||
        e.messageHash.toLowerCase() !== BRIDGE_ZERO_WORD || info.updatedRecipient.toLowerCase() !== c.recipient ||
        info.updatedMessageHash.toLowerCase() !== BRIDGE_ZERO_WORD || info.updatedOutputAmount.toString() !== c.outputAmountAtomic ||
        !Number.isInteger(info.fillType) || info.fillType < 0 || info.fillType > 2)
        fail("FilledRelay");
    const relayerCredit = bridgeHex(e.relayer, 32, 32, "APN_RPC_PROTOCOL");
    const repaymentChainIdAtomic = bridgeUint(e.repaymentChainId.toString()).toString();
    if (info.fillType === 2 && (relayerCredit !== BRIDGE_ZERO_WORD || repaymentChainIdAtomic !== "0"))
        fail("slow_fill_credit");
    const transfers = events(receipt, decoded.destinationToken, EVENT_TOPICS.transfer, "Transfer");
    const delivered = transfers.filter((x) => x.to === decoded.recipient);
    if (delivered.length !== 1 || bridgeAddress(delivered[0].from) !== delivered[0].from || delivered[0].from === BRIDGE_ZERO_ADDRESS ||
        delivered[0].value.toString() !== c.outputAmountAtomic || (info.fillType === 2 && delivered[0].from !== emitter))
        fail("destination_token_movement");
    return destinationResult(source, decoded, receipt, info.updatedOutputAmount.toString(), info.fillType, relayerCredit, repaymentChainIdAtomic);
}
function stargateDestination(source, decoded, receipt) {
    if (source.correlation.kind !== "stargateV2")
        return fail("stargate_correlation");
    const c = source.correlation;
    const emitter = bridgeProtocolEmitter(decoded.destinationChainId, "stargateV2", decoded.destinationToken);
    const received = oneEvent(receipt, emitter, EVENT_TOPICS.oftReceived, "OFTReceived");
    const cached = events(receipt, emitter, EVENT_TOPICS.unreceivedTokenCached, "UnreceivedTokenCached");
    if (cached.some((x) => x.guid.toLowerCase() === c.guid) || received.guid.toLowerCase() !== c.guid || received.srcEid !== c.sourceEid ||
        received.toAddress !== c.recipient || received.amountReceivedLD.toString() !== c.amountReceivedAtomic ||
        received.amountReceivedLD < BigInt(decoded.minimumOutputAtomic))
        fail("OFTReceived");
    const transfers = events(receipt, decoded.destinationToken, EVENT_TOPICS.transfer, "Transfer");
    const delivered = transfers.filter((x) => x.to === decoded.recipient);
    if (delivered.length !== 1 || delivered[0].from !== emitter || delivered[0].value !== received.amountReceivedLD)
        fail("destination_token_movement");
    return destinationResult(source, decoded, receipt, received.amountReceivedLD.toString(), null, null, null);
}
function destinationResult(source, decoded, receipt, amountAtomic, fillType, relayerCredit, repaymentChainIdAtomic) {
    return {
        tool: decoded.tool, chainId: receipt.chainId, transactionHash: receipt.transactionHash, blockNumberAtomic: receipt.blockNumberAtomic,
        blockHash: receipt.blockHash, recipient: decoded.recipient, token: decoded.destinationToken, amountAtomic,
        correlationHash: sha256(canonicalJson(source.correlation)), logsHash: logsHash(receipt.logs), fillType, relayerCredit, repaymentChainIdAtomic,
    };
}
function validateReceipt(receipt) {
    bridgeUint(receipt.blockNumberAtomic, true, "APN_RPC_PROTOCOL");
    if (bridgeHex(receipt.transactionHash, 32, 32, "APN_RPC_PROTOCOL") === BRIDGE_ZERO_WORD ||
        bridgeHex(receipt.blockHash, 32, 32, "APN_RPC_PROTOCOL") === BRIDGE_ZERO_WORD)
        fail("receipt_identity");
    if (receipt.logs.length > 512)
        fail("log_count");
    for (const log of receipt.logs) {
        if (bridgeAddress(log.address, "APN_RPC_PROTOCOL") !== log.address || log.topics.length > 4)
            fail("log_shape");
        for (const topic of log.topics)
            bridgeHex(topic, 32, 32, "APN_RPC_PROTOCOL");
        bridgeHex(log.data, 12 * 1024, undefined, "APN_RPC_PROTOCOL");
    }
}
function oneEvent(receipt, address, topic, eventName) {
    const matches = events(receipt, address, topic, eventName);
    if (matches.length !== 1)
        fail(`${eventName}_count`);
    return matches[0];
}
function events(receipt, address, topic, eventName) {
    const output = [];
    for (const log of receipt.logs) {
        if (log.address !== address || log.topics[0]?.toLowerCase() !== topic)
            continue;
        try {
            const decoded = decodeEventLog({ abi: bridgeEventsAbi, eventName: eventName, data: log.data, topics: log.topics, strict: true });
            if (decoded.eventName !== eventName)
                fail(`${eventName}_decode`);
            output.push(decoded.args);
        }
        catch {
            fail(`${eventName}_decode`);
        }
    }
    return output;
}
function logsHash(logs) { return sha256(canonicalJson(logs)); }
function uintWord(value) { return `0x${BigInt(value).toString(16).padStart(64, "0")}`; }
function addressWord(address) { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`; }
function chainForEid(eid) { if (eid === 30101)
    return 1; if (eid === 30184)
    return 8453; if (eid === 30110)
    return 42161; return fail("endpoint_identity"); }
function fail(reason) { return bridgeFailure("APN_RPC_PROTOCOL", reason); }
//# sourceMappingURL=protocol-evidence.js.map