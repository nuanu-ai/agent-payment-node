import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex } from "../../evm-rpc-codec.js";
import { UNISWAP_V3_QUOTER_V2, UNISWAP_WETH9, type UniswapV3PairPin } from "./pins.js";

const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);
const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const Q192 = 1n << 192n, FEE_DENOMINATOR = 1_000_000n;

/** Everything the owner sees about price is read from the pinned pool and QuoterV2 at one block. */
export interface UniswapV3PoolQuote {
  readonly pool: string;
  readonly fee: number;
  readonly sqrtPriceX96: string;
  readonly tick: number;
  readonly liquidity: string;
  readonly amountOutAtomic: string;
  readonly sqrtPriceX96After: string;
  readonly initializedTicksCrossed: number;
  readonly quoterGasEstimate: string;
  /** Output for exactly one whole ETH at the slot0 spot price, before fees. */
  readonly spotOutputPerEthAtomic: string;
  /** Spot output for this input after the pool LP fee: the zero-impact reference. */
  readonly spotOutputAfterFeeAtomic: string;
  /** Rounded up shortfall of the quoted output against the fee-adjusted spot output. */
  readonly priceImpactBps: number;
}

export async function readUniswapV3Quote(call: EvmRpcCall, pair: UniswapV3PairPin, amountIn: bigint, tag: Hex): Promise<UniswapV3PoolQuote> {
  if (amountIn <= 0n) invalid("Uniswap input amount must be positive.");
  const slot0 = decodeFunctionResult({ abi: POOL_ABI, functionName: "slot0",
    data: evmRpcHex(await call("eth_call", [{ to: pair.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: "slot0" }) }, tag])) });
  const liquidity = decodeFunctionResult({ abi: POOL_ABI, functionName: "liquidity",
    data: evmRpcHex(await call("eth_call", [{ to: pair.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: "liquidity" }) }, tag])) });
  const [sqrtPriceX96, tick, , , , , unlocked] = slot0;
  if (!unlocked || sqrtPriceX96 === 0n || liquidity === 0n) blocked("The pinned pool is locked, uninitialized, or has no active liquidity.", "uniswap_pool_state");
  const quoteData = encodeFunctionData({ abi: QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ tokenIn: UNISWAP_WETH9,
    tokenOut: pair.outputToken as `0x${string}`, amountIn, fee: pair.fee, sqrtPriceLimitX96: 0n }] });
  let raw: Hex;
  try { raw = evmRpcHex(await call("eth_call", [{ to: UNISWAP_V3_QUOTER_V2, data: quoteData }, tag])); }
  catch (error) {
    if (error instanceof ApnError && error.code === "APN_RPC_CONFIG") throw error;
    return blocked("QuoterV2 could not quote the pinned pool.", "uniswap_quoter_unavailable");
  }
  const [amountOut, sqrtPriceX96After, initializedTicksCrossed, quoterGasEstimate] =
    decodeFunctionResult({ abi: QUOTER_ABI, functionName: "quoteExactInputSingle", data: raw });
  if (amountOut <= 0n) blocked("QuoterV2 returned no output.", "uniswap_quote_zero");
  const afterFee = amountIn * (FEE_DENOMINATOR - BigInt(pair.fee)) / FEE_DENOMINATOR;
  const spotAfterFee = spotOutput(afterFee, sqrtPriceX96, pair.wethIsToken0);
  const shortfall = spotAfterFee > amountOut ? spotAfterFee - amountOut : 0n;
  const impact = spotAfterFee === 0n ? 10_000n : (shortfall * 10_000n + spotAfterFee - 1n) / spotAfterFee;
  return { pool: pair.pool, fee: pair.fee, sqrtPriceX96: sqrtPriceX96.toString(), tick, liquidity: liquidity.toString(),
    amountOutAtomic: amountOut.toString(), sqrtPriceX96After: sqrtPriceX96After.toString(), initializedTicksCrossed,
    quoterGasEstimate: quoterGasEstimate.toString(), spotOutputPerEthAtomic: spotOutput(10n ** 18n, sqrtPriceX96, pair.wethIsToken0).toString(),
    spotOutputAfterFeeAtomic: spotAfterFee.toString(), priceImpactBps: Number(impact > 10_000n ? 10_000n : impact) };
}

/** sqrtPriceX96^2 / 2^192 is token1 per token0 in atomic units. */
export function spotOutput(amountIn: bigint, sqrtPriceX96: bigint, wethIsToken0: boolean): bigint {
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return wethIsToken0 ? amountIn * squared / Q192 : amountIn * Q192 / squared;
}

function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
