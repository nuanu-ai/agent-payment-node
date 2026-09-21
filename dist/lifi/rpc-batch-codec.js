import { ApnError } from "../errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import { bridgeHex, bridgeUint } from "./validation.js";
export function rpcQuantityValue(value) { return evmRpcQuantity(value); }
export function rpcExpectedChainValue(chainId) {
    return (value) => {
        const observed = evmRpcQuantity(value);
        if (observed !== BigInt(chainId))
            throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
        return observed;
    };
}
export function rpcWordValue(value) { return evmRpcWord(value); }
export function rpcHexValue(maximumBytes) {
    return (value) => bridgeHex(value, maximumBytes, undefined, "APN_RPC_PROTOCOL");
}
export function rpcRecordValue(value) { return evmRpcRecord(value); }
export function rpcBlockValue(value) {
    const block = evmRpcRecord(value);
    evmRpcQuantity(block.number);
    evmRpcHex(block.hash, 32);
    evmRpcQuantity(block.timestamp);
    return block;
}
export function rpcFeeBlockValue(value) {
    const block = rpcBlockValue(value);
    evmRpcQuantity(block.baseFeePerGas);
    return block;
}
export function rpcTransactionInput(transaction) {
    return { from: transaction.from, to: transaction.to, data: transaction.data, value: quantity(bridgeUint(transaction.valueAtomic)) };
}
export function bridgeFeeQuote(chainId, origin, block, execution, l1, operator) {
    return { chainId, ...(chainId === 42161 ? { feeModel: "arbitrum-inclusive" } : chainId === 143 ? { feeModel: "monad-gas-limit" } : {}),
        l1DataFeeUpperWei: l1.toString(), operatorFeeUpperWei: operator.toString(), maximumExecutionFeeWei: execution.toString(),
        totalQuoteWei: (execution + l1 + operator).toString(), totalFeeEnforcedOnchain: false,
        blockNumberAtomic: block.numberAtomic, blockHash: block.hash, rpcOrigin: origin, observedAt: new Date().toISOString() };
}
function quantity(n) { return `0x${n.toString(16)}`; }
//# sourceMappingURL=rpc-batch-codec.js.map