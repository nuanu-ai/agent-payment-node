import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { ApnError } from "../../errors.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity, recheckEvmBlock } from "../../evm-rpc-codec.js";
import { UNISWAP_V3_QUOTER_V2 } from "./pins.js";
import { verifyUniswapTokenRoutePins } from "./token-route.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const QUOTER = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
/** Fresh post-approval guard: exact allowance, code pins, quote floor, and exact swap simulation. */
export class UniswapTokenRevalidator {
    call;
    constructor(call) {
        this.call = call;
    }
    async revalidate(op) {
        if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token execution requires Ethereum chain 1.");
        const block = await evmRpcBlock(this.call, "latest");
        await verifyUniswapTokenRoutePins(this.call, block.tag);
        const allowanceData = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [op.account, op.route.router] });
        const allowance = BigInt(evmRpcHex(await this.call("eth_call", [{ to: op.route.inputToken, data: allowanceData }, block.tag]), 32));
        if (allowance !== BigInt(op.route.amountIn))
            blocked("Exact token allowance changed before swap signing.", "uniswap_token_allowance_drift");
        const quoteData = encodeFunctionData({ abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ tokenIn: op.route.inputToken,
                    tokenOut: op.route.outputToken, amountIn: BigInt(op.route.amountIn), fee: 100, sqrtPriceLimitX96: 0n }] });
        const [amountOut] = decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle",
            data: evmRpcHex(await this.call("eth_call", [{ to: UNISWAP_V3_QUOTER_V2, data: quoteData }, block.tag])) });
        if (amountOut < BigInt(op.route.amountOutMinimum))
            blocked("Fresh quote is below the approved minimum.", "uniswap_token_output_floor");
        const tx = { from: op.account, to: op.route.router, data: op.route.calldata, value: "0x0" };
        await this.call("eth_call", [tx, block.tag]);
        if (evmRpcQuantity(await this.call("eth_estimateGas", [tx, block.tag])) > BigInt(op.swapGas.gasLimit))
            blocked("Fresh swap gas exceeds the approved cap.", "uniswap_token_gas_cap");
        await recheckEvmBlock(this.call, block);
    }
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-revalidation.js.map