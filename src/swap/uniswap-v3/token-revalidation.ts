import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { UNISWAP_V3_QUOTER_V2 } from "./pins.js";
import type { UniswapTokenOperation } from "./token-operation.js";
import { verifyUniswapTokenRoutePins } from "./token-route.js";
import { tokenBatch, tokenBlock, tokenChain, tokenHex, tokenQuantity, type TokenRpcCall } from "./token-rpc.js";

const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const QUOTER = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);

/** Fresh post-approval guard: exact allowance, code pins, quote floor, and exact swap simulation. */
export class UniswapTokenRevalidator {
  constructor(private readonly call: EvmRpcCall,
    private readonly verifyPins: (call: EvmRpcCall, tag: Hex) => Promise<void> = verifyUniswapTokenRoutePins) {}
  async revalidate(op: UniswapTokenOperation): Promise<void> {
    const rpc = this.call as TokenRpcCall, [chain, rawBlock] = await tokenBatch(rpc, "primary", [
      { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain },
      { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: tokenBlock },
    ]);
    if (evmRpcQuantity(chain) !== 1n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token execution requires Ethereum chain 1.");
    const block = decodedBlock(rawBlock); await this.verifyPins(this.call, block.tag);
    const allowanceData = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [op.account as Hex, op.route.router] });
    const quoteData = encodeFunctionData({ abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ tokenIn: op.route.inputToken as Hex,
      tokenOut: op.route.outputToken as Hex, amountIn: BigInt(op.route.amountIn), fee: 100, sqrtPriceLimitX96: 0n }] });
    const tx = { from: op.account, to: op.route.router, data: op.route.calldata, value: "0x0" };
    const [rawAllowance, rawQuote] = await tokenBatch(rpc, "archive", [
      { method: "eth_call", params: [{ to: op.route.inputToken, data: allowanceData }, block.tag], cachePolicy: "snapshot", decoder: allowanceDecoder },
      { method: "eth_call", params: [{ to: UNISWAP_V3_QUOTER_V2, data: quoteData }, block.tag], cachePolicy: "none", decoder: quoteDecoder },
    ]), allowance = BigInt(evmRpcHex(rawAllowance, 32));
    if (allowance !== BigInt(op.route.amountIn)) blocked("Exact token allowance changed before swap signing.", "uniswap_token_allowance_drift");
    const [amountOut] = decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle",
      data: evmRpcHex(rawQuote) });
    if (amountOut < BigInt(op.route.amountOutMinimum)) blocked("Fresh quote is below the approved minimum.", "uniswap_token_output_floor");
    await tokenBatch(rpc, "archive", [{ method: "eth_call", params: [tx, block.tag], cachePolicy: "none", decoder: tokenHex() }]);
    const [estimate, rechecked] = await tokenBatch(rpc, "primary", [
      { method: "eth_estimateGas", params: [tx, block.tag], cachePolicy: "none", decoder: tokenQuantity },
      { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none", decoder: tokenBlock },
    ]);
    if (evmRpcQuantity(estimate) > BigInt(op.swapGas.gasLimit)) blocked("Fresh swap gas exceeds the approved cap.", "uniswap_token_gas_cap");
    if (decodedBlock(rechecked).hash !== block.hash) throw new ApnError("APN_RPC_PROTOCOL", "EVM block changed around pinned reads.");
  }
}
function allowanceDecoder(value: unknown) { decodeFunctionResult({ abi: ERC20, functionName: "allowance", data: evmRpcHex(value, 32) }); return value; }
function quoteDecoder(value: unknown) { decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", data: evmRpcHex(value) }); return value; }
function decodedBlock(value: unknown) { const raw = evmRpcRecord(value), number = evmRpcQuantity(raw.number), hash = evmRpcHex(raw.hash, 32);
  return { tag: `0x${number.toString(16)}` as Hex, hash }; }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
