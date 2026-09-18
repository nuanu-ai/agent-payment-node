import { encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, parseAbi } from "viem";
import { ApnError } from "../../errors.js";
import { parseAtomic } from "../../money.js";
import { decodeUniswapRouterCalldata, type UniswapDecodedRoute } from "../uniswap-router.js";
import { UNISWAP_WETH9, type UniswapV3PairPin } from "./pins.js";

const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
/** Universal Router 2.2.0 Commands.WRAP_ETH (0x0b) then Commands.V3_SWAP_EXACT_IN (0x00). */
const COMMANDS = "0x0b00" as const;
/** Universal Router ActionConstants.ADDRESS_THIS: the router wraps the exact input and pays the pool itself. */
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface UniswapV3ExactInputCall {
  readonly recipient: string;
  readonly inputAmountAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly deadline: number;
  readonly pair: UniswapV3PairPin;
}

/**
 * Exact inverse of decodeUniswapRouterCalldata: execute(0x0b00, [WRAP_ETH(ADDRESS_THIS, amountIn),
 * V3_SWAP_EXACT_IN(recipient, amountIn, amountOutMin, WETH|fee|output, payerIsUser=false, minHopPriceX36=[])], deadline).
 * The empty per-hop floor array is the router's documented "no per-hop check"; the single-hop amountOutMin is the floor.
 */
export function encodeUniswapV3ExactInput(input: UniswapV3ExactInputCall): { readonly data: `0x${string}`; readonly route: UniswapDecodedRoute } {
  const recipient = canonical(input.recipient), amountIn = uint(input.inputAmountAtomic), amountOutMin = uint(input.minimumOutputAtomic);
  if (!Number.isSafeInteger(input.deadline) || input.deadline <= 0 || input.deadline > 4_294_967_295) invalid("Uniswap deadline is invalid.");
  const path = encodePacked(["address", "uint24", "address"], [UNISWAP_WETH9, input.pair.fee, canonical(input.pair.outputToken)]);
  const wrap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ADDRESS_THIS, amountIn]);
  const swap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" },
    { type: "uint256[]" }], [recipient, amountIn, amountOutMin, path, false, []]);
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "execute", args: [COMMANDS, [wrap, swap], BigInt(input.deadline)] });
  const route = decodeUniswapRouterCalldata(data, { recipient, inputAmountAtomic: amountIn.toString(),
    minimumOutputAtomic: amountOutMin.toString(), deadline: input.deadline });
  if (route.command !== "V3_SWAP_EXACT_IN" || route.recipient !== recipient || route.inputAmountAtomic !== amountIn.toString() ||
      route.minimumOutputAtomic !== amountOutMin.toString() || route.deadline !== input.deadline) {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "Local Universal Router encoding did not round-trip through the strict decoder.");
  }
  return { data, route };
}

function canonical(value: string): `0x${string}` {
  try { const result = getAddress(value); if (result !== value || /^0x0{40}$/u.test(result)) throw new Error(); return result; }
  catch { return invalid("Uniswap address is invalid or non-canonical."); }
}
function uint(value: string): bigint {
  try { if (typeof value !== "string" || value.length > 78) throw new Error(); const parsed = parseAtomic(value, { positive: true });
    if (parsed > MAX_UINT256) throw new Error(); return parsed; }
  catch { return invalid("Uniswap integer is invalid."); }
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
