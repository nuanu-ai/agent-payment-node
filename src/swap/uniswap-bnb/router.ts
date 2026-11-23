import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import { canonicalJson, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { parseAtomic } from "../../money.js";
import type { UniswapV3ExactInputCall } from "../uniswap-v3/encoder.js";
import type { UniswapNativeRoute, UniswapNativeRouteExpectation } from "../uniswap-v3/native-lane.js";
import { BNB_UNISWAP_SWAP_ROUTER_02, BNB_WBNB, bnbUniswapPair } from "./pins.js";

const ROUTER_ABI = parseAbi([
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);
const MAX_UINT256 = (1n << 256n) - 1n;
/** SwapRouter02 reads recipient 0x…01 as msg.sender and 0x…02 as the router itself, where anyone could sweep the output. */
const SENTINEL_RECIPIENTS = new Set(["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"]);

/**
 * SwapRouter02 multicall(deadline, [exactInputSingle(WBNB, output, pinned fee, recipient, amountIn, amountOutMinimum, 0)])
 * with msg.value = amountIn: the router wraps exactly the native input into WBNB and pays the pinned pool (PeripheryPayments
 * .pay). The multicall deadline is the quote expiry; amountOutMinimum is the only floor; no price limit, no refund call.
 */
export function encodeBnbUniswapExactInput(input: UniswapV3ExactInputCall): { readonly data: Hex; readonly route: UniswapNativeRoute } {
  const recipient = recipientOf(input.recipient), amountIn = uint(input.inputAmountAtomic), amountOutMin = uint(input.minimumOutputAtomic);
  if (!Number.isSafeInteger(input.deadline) || input.deadline <= 0 || input.deadline > 4_294_967_295) invalid("BNB Uniswap deadline is invalid.");
  const pair = bnbUniswapPair(canonical(input.pair.outputToken));
  if (pair.pool !== input.pair.pool || pair.fee !== input.pair.fee) invalid("BNB Uniswap pair is not the pinned pool.");
  const swap = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: BNB_WBNB, tokenOut: canonical(pair.outputToken),
    fee: pair.fee, recipient, amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0n }] });
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [BigInt(input.deadline), [swap]] });
  const route = decodeBnbUniswapRouterCalldataFor(data, { recipient, inputAmountAtomic: amountIn.toString(),
    minimumOutputAtomic: amountOutMin.toString(), deadline: input.deadline, outputToken: pair.outputToken });
  if (route.recipient !== recipient || route.inputAmountAtomic !== amountIn.toString() || route.minimumOutputAtomic !== amountOutMin.toString() ||
      route.deadline !== input.deadline) {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "Local SwapRouter02 encoding did not round-trip through the strict decoder.");
  }
  return { data, route };
}

/**
 * Strict SwapRouter02 proof: exactly one exactInputSingle inside multicall(deadline, …), canonically encoded, from WBNB to
 * the expected pinned output at its pinned fee tier, for the exact recipient and input, with a floor at least the expected
 * minimum and no price limit. Anything else (another function, a second call, a sweep or unwrap) is refused.
 */
export function decodeBnbUniswapRouterCalldataFor(data: Hex, expected: UniswapNativeRouteExpectation): UniswapNativeRoute {
  try {
    const outer = decodeFunctionData({ abi: ROUTER_ABI, data });
    if (outer.functionName !== "multicall") fail();
    const [rawDeadline, calls] = outer.args;
    if (rawDeadline !== BigInt(expected.deadline) || calls.length !== 1 ||
        encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [rawDeadline, calls] }).toLowerCase() !== data.toLowerCase()) fail();
    const inner = decodeFunctionData({ abi: ROUTER_ABI, data: calls[0]! });
    if (inner.functionName !== "exactInputSingle") fail();
    const params = inner.args[0];
    if (encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [params] }).toLowerCase() !== calls[0]!.toLowerCase()) fail();
    const pair = bnbUniswapPair(getAddress(expected.outputToken));
    if (getAddress(params.tokenIn) !== BNB_WBNB || getAddress(params.tokenOut) !== pair.outputToken || params.fee !== pair.fee ||
        params.sqrtPriceLimitX96 !== 0n || getAddress(params.recipient) !== expected.recipient || SENTINEL_RECIPIENTS.has(getAddress(params.recipient)) ||
        params.amountIn !== BigInt(expected.inputAmountAtomic) || params.amountOutMinimum < BigInt(expected.minimumOutputAtomic)) fail();
    const route = { command: "SWAP_ROUTER_02_MULTICALL_EXACT_INPUT_SINGLE", router: BNB_UNISWAP_SWAP_ROUTER_02,
      path: { tokens: [BNB_WBNB, pair.outputToken], hops: [pair.fee] }, sqrtPriceLimitX96: "0" };
    return { recipient: getAddress(params.recipient), inputAmountAtomic: params.amountIn.toString(),
      minimumOutputAtomic: params.amountOutMinimum.toString(), deadline: Number(rawDeadline), routeHash: sha256(canonicalJson(route)) };
  } catch (error) { if (error instanceof ApnError) throw error; return fail(); }
}

function recipientOf(value: string): `0x${string}` {
  const recipient = canonical(value);
  if (SENTINEL_RECIPIENTS.has(recipient) || recipient === BNB_UNISWAP_SWAP_ROUTER_02 || recipient === BNB_WBNB) {
    invalid("BNB Uniswap recipient must be an account, not a router sentinel or a pinned contract.");
  }
  return recipient;
}
function canonical(value: string): `0x${string}` {
  try { const result = getAddress(value); if (result !== value || /^0x0{40}$/u.test(result)) throw new Error(); return result; }
  catch { return invalid("BNB Uniswap address is invalid or non-canonical."); }
}
function uint(value: string): bigint {
  try { if (typeof value !== "string" || value.length > 78) throw new Error(); const parsed = parseAtomic(value, { positive: true });
    if (parsed > MAX_UINT256) throw new Error(); return parsed; }
  catch { return invalid("BNB Uniswap integer is invalid."); }
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function fail(): never { throw new ApnError("APN_PROVIDER_PROTOCOL", "SwapRouter02 calldata is unsupported or does not prove the exact guarded swap."); }
