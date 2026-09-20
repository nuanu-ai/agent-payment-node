import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, pad, size, zeroAddress } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity, recheckEvmBlock } from "../evm-rpc-codec.js";
import { STARGATE_QUOTE_ABI, STARGATE_QUOTE_OFT_OUTPUT, STARGATE_QUOTE_SEND_OUTPUT } from "./abi.js";
import { stargateV2Route } from "./registry.js";
const uint = (value) => {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value))
        throw new ApnError("APN_INVALID_INPUT", "Stargate amount must be a canonical uint256 string.");
    const result = BigInt(value);
    if (result <= 0n || result >= 1n << 256n)
        throw new ApnError("APN_INVALID_INPUT", "Stargate amount is outside uint256.");
    return result;
};
const protocol = (reason) => { throw new ApnError("APN_RPC_PROTOCOL", `Direct Stargate V2 quote failed closed: ${reason}.`); };
const boundedResult = (value) => {
    const result = evmRpcHex(value);
    if (size(result) > 64 * 1024)
        return protocol("returndata exceeds the bound");
    return result;
};
const decodeExact = (raw, parameters) => {
    try {
        const decoded = decodeAbiParameters(parameters, raw);
        if (encodeAbiParameters(parameters, decoded) !== raw)
            return protocol("returndata is not canonical ABI");
        return decoded;
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        return protocol("returndata is malformed");
    }
};
export async function quoteStargateV2Direct(request, call) {
    const snapshot = canonicalJson(request), amount = uint(request.amountAtomic), recipient = canonicalAddress(request.recipient);
    const route = stargateV2Route({ chainId: request.sourceChainId, token: request.sourceToken }, { chainId: request.destinationChainId, token: request.destinationToken });
    await assertChain(call, route.from.chainId);
    const block = await evmRpcBlock(call, "latest"), code = boundedResult(await call("eth_getCode", [route.from.pool, block.tag]));
    if (code === "0x")
        protocol("the pinned source contract has no code");
    const sendParam = { dstEid: route.to.eid, to: pad(recipient, { size: 32 }), amountLD: amount, minAmountLD: 0n,
        extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const quoteOftData = encodeFunctionData({ abi: STARGATE_QUOTE_ABI, functionName: "quoteOFT", args: [sendParam] });
    const oftRaw = boundedResult(await call("eth_call", [{ to: route.from.pool, data: quoteOftData }, block.tag]));
    const [limit, details, receipt] = decodeExact(oftRaw, STARGATE_QUOTE_OFT_OUTPUT);
    if (details.length > 8 || details.some((entry) => Buffer.byteLength(entry.description, "utf8") > 256 || /[\u0000-\u001f\u007f]/u.test(entry.description))) {
        protocol("fee details are malformed");
    }
    const conversionRate = 10n ** BigInt(route.from.localDecimals - route.from.sharedDecimals);
    const canonicalSent = amount - amount % conversionRate;
    const feeTotal = details.reduce((total, entry) => total + entry.feeAmountLD, 0n);
    if (limit.minAmountLD !== conversionRate || limit.minAmountLD > limit.maxAmountLD || amount > limit.maxAmountLD ||
        receipt.amountSentLD !== canonicalSent || receipt.amountSentLD < limit.minAmountLD || receipt.amountReceivedLD <= 0n ||
        receipt.amountReceivedLD - receipt.amountSentLD !== feeTotal)
        protocol("quote amounts are inconsistent");
    const quoteSendData = encodeFunctionData({ abi: STARGATE_QUOTE_ABI, functionName: "quoteSend", args: [sendParam, false] });
    const feeRaw = boundedResult(await call("eth_call", [{ to: route.from.pool, data: quoteSendData }, block.tag]));
    const [fee] = decodeExact(feeRaw, STARGATE_QUOTE_SEND_OUTPUT);
    if (fee.lzTokenFee !== 0n)
        protocol("native fee quote unexpectedly returned an LZ token fee");
    await recheckEvmBlock(call, block);
    await assertChain(call, route.from.chainId);
    if (snapshot !== canonicalJson(request))
        protocol("quote request mutated during the pinned reads");
    const evidence = {
        schemaVersion: "apn.stargate-v2-direct-quote.v1", executionAdmitted: false,
        route: { sourceChainId: route.from.chainId, sourceEid: route.from.eid, sourceToken: route.from.token, sourcePool: route.from.pool,
            destinationChainId: route.to.chainId, destinationEid: route.to.eid, destinationToken: route.to.token, destinationPool: route.to.pool, asset: route.from.asset },
        quote: { requestedAmountAtomic: amount.toString(), minimumTransferAtomic: limit.minAmountLD.toString(), maximumTransferAtomic: limit.maxAmountLD.toString(),
            amountSentAtomic: receipt.amountSentLD.toString(), minimumOutputAtomic: receipt.amountReceivedLD.toString(),
            protocolFees: details.map((entry) => ({ amountAtomic: entry.feeAmountLD.toString(), description: entry.description })),
            nativeMessageFeeAtomic: fee.nativeFee.toString(), lzTokenFeeAtomic: "0" },
        recipient, block: { numberAtomic: block.number, hash: block.hash }, requestHash: hashObject(JSON.parse(snapshot)),
    };
    return Object.freeze({ ...evidence, quoteHash: hashObject(evidence) });
}
function canonicalAddress(value) {
    try {
        const result = getAddress(value);
        if (result === zeroAddress)
            throw new Error("zero");
        return result;
    }
    catch {
        throw new ApnError("APN_INVALID_INPUT", "Stargate recipient must be a nonzero EVM address.");
    }
}
async function assertChain(call, expected) {
    if (evmRpcQuantity(await call("eth_chainId", [])) !== BigInt(expected))
        throw new ApnError("APN_CHAIN_MISMATCH", "Stargate RPC chain identity does not match the source route.");
}
//# sourceMappingURL=quote.js.map