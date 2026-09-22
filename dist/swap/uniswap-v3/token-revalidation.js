import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { ApnError } from "../../errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { UNISWAP_V3_QUOTER_V2 } from "./pins.js";
import { verifyUniswapTokenRoutePins } from "./token-route.js";
import { tokenBatch } from "./token-rpc.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const QUOTER = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
/** Fresh post-approval guard: exact allowance, code pins, quote floor, and exact swap simulation. */
export class UniswapTokenRevalidator {
    call;
    verifyPins;
    constructor(call, verifyPins = verifyUniswapTokenRoutePins) {
        this.call = call;
        this.verifyPins = verifyPins;
    }
    async revalidate(op) {
        const rpc = this.call, [chain, rawBlock] = await tokenBatch(rpc, "primary", [
            { method: "eth_chainId", params: [], cachePolicy: "immutable" },
            { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none" },
        ]);
        if (evmRpcQuantity(chain) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token execution requires Ethereum chain 1.");
        const block = decodedBlock(rawBlock);
        await this.verifyPins(this.call, block.tag);
        const allowanceData = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [op.account, op.route.router] });
        const quoteData = encodeFunctionData({ abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ tokenIn: op.route.inputToken,
                    tokenOut: op.route.outputToken, amountIn: BigInt(op.route.amountIn), fee: 100, sqrtPriceLimitX96: 0n }] });
        const tx = { from: op.account, to: op.route.router, data: op.route.calldata, value: "0x0" };
        const [rawAllowance, rawQuote] = await tokenBatch(rpc, "archive", [
            { method: "eth_call", params: [{ to: op.route.inputToken, data: allowanceData }, block.tag], cachePolicy: "snapshot" },
            { method: "eth_call", params: [{ to: UNISWAP_V3_QUOTER_V2, data: quoteData }, block.tag], cachePolicy: "none" },
        ]), allowance = BigInt(evmRpcHex(rawAllowance, 32));
        if (allowance !== BigInt(op.route.amountIn))
            blocked("Exact token allowance changed before swap signing.", "uniswap_token_allowance_drift");
        const [amountOut] = decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle",
            data: evmRpcHex(rawQuote) });
        if (amountOut < BigInt(op.route.amountOutMinimum))
            blocked("Fresh quote is below the approved minimum.", "uniswap_token_output_floor");
        await tokenBatch(rpc, "archive", [{ method: "eth_call", params: [tx, block.tag], cachePolicy: "none" }]);
        const [estimate, rechecked] = await tokenBatch(rpc, "primary", [
            { method: "eth_estimateGas", params: [tx, block.tag], cachePolicy: "none" },
            { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none" },
        ]);
        if (evmRpcQuantity(estimate) > BigInt(op.swapGas.gasLimit))
            blocked("Fresh swap gas exceeds the approved cap.", "uniswap_token_gas_cap");
        if (decodedBlock(rechecked).hash !== block.hash)
            throw new ApnError("APN_RPC_PROTOCOL", "EVM block changed around pinned reads.");
    }
}
function decodedBlock(value) {
    const raw = evmRpcRecord(value), number = evmRpcQuantity(raw.number), hash = evmRpcHex(raw.hash, 32);
    return { tag: `0x${number.toString(16)}`, hash };
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-revalidation.js.map