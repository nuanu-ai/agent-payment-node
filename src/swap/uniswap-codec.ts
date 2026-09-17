import { getAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { parseAtomic } from "../money.js";
import { UNISWAP_CHAIN_ID, UNISWAP_NATIVE, UNISWAP_ROUTER, UNISWAP_USDC } from "./uniswap-pin.js";

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,256}$/u, HEX = /^0x(?:[0-9a-fA-F]{2})+$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
export interface UniswapQuoteRequest {
  readonly type: "EXACT_INPUT"; readonly amount: string; readonly tokenInChainId: 1; readonly tokenOutChainId: 1;
  readonly tokenIn: typeof UNISWAP_NATIVE; readonly tokenOut: typeof UNISWAP_USDC; readonly swapper: string;
  readonly recipient: string; readonly slippageTolerance: number; readonly protocols: readonly ["V2", "V3", "V4"];
  readonly routingPreference: "BEST_PRICE"; readonly permitAmount: "EXACT"; readonly generatePermitAsTransaction: false;
}
export interface UniswapClassicQuote {
  readonly chainId: 1; readonly input: { readonly token: typeof UNISWAP_NATIVE; readonly amount: string };
  readonly output: { readonly token: typeof UNISWAP_USDC; readonly amount: string; readonly recipient: string };
  readonly swapper: string; readonly tradeType: "EXACT_INPUT"; readonly slippageTolerance: number; readonly route: readonly unknown[];
}
export interface UniswapQuoteResponse { readonly requestId: string; readonly routing: "CLASSIC";
  readonly quote: UniswapClassicQuote; readonly isTokenApprovalApplicable: false; readonly permitData: null }
export interface UniswapTransactionEnvelope { readonly from: string; readonly to: typeof UNISWAP_ROUTER; readonly data: `0x${string}`;
  readonly value: string; readonly gasLimit: string; readonly chainId: 1; readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string; readonly gasPrice?: string }
export interface UniswapSwapResponse { readonly requestId: string; readonly swap: UniswapTransactionEnvelope; readonly gasFee: string }

export function createUniswapQuoteRequest(input: { readonly amountAtomic: string; readonly swapper: string;
  readonly recipient: string; readonly slippageBps: number; readonly ownerSlippageCapBps: number }): UniswapQuoteRequest {
  const amount = uint(input.amountAtomic, true), swapper = address(input.swapper), recipient = address(input.recipient);
  if (!Number.isSafeInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 10_000 ||
      !Number.isSafeInteger(input.ownerSlippageCapBps) || input.ownerSlippageCapBps < 0 || input.ownerSlippageCapBps > 10_000 ||
      input.slippageBps > input.ownerSlippageCapBps) invalid("Uniswap slippage exceeds the owner cap.");
  return { type: "EXACT_INPUT", amount, tokenInChainId: 1, tokenOutChainId: 1, tokenIn: UNISWAP_NATIVE,
    tokenOut: UNISWAP_USDC, swapper, recipient, slippageTolerance: input.slippageBps / 100,
    protocols: ["V2", "V3", "V4"], routingPreference: "BEST_PRICE", permitAmount: "EXACT", generatePermitAsTransaction: false };
}

export function decodeUniswapQuoteResponse(value: unknown, request: UniswapQuoteRequest): UniswapQuoteResponse {
  if (!isPlainRecord(value) || !exactKeys(value, ["requestId", "routing", "quote", "isTokenApprovalApplicable", "permitData"]) ||
      typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId) || value.routing !== "CLASSIC" ||
      value.isTokenApprovalApplicable !== false || value.permitData !== null || !isPlainRecord(value.quote) ||
      !exactKeys(value.quote, ["chainId", "input", "output", "swapper", "tradeType", "slippageTolerance", "route"])) malformed("quote response");
  const quote = value.quote;
  if (quote.chainId !== 1 || quote.swapper !== request.swapper || quote.tradeType !== "EXACT_INPUT" ||
      quote.slippageTolerance !== request.slippageTolerance || !Array.isArray(quote.route) || quote.route.length === 0 || quote.route.length > 16 ||
      !isPlainRecord(quote.input) || !exactKeys(quote.input, ["token", "amount"]) || quote.input.token !== UNISWAP_NATIVE ||
      quote.input.amount !== request.amount || !isPlainRecord(quote.output) || !exactKeys(quote.output, ["token", "amount", "recipient"]) ||
      quote.output.token !== UNISWAP_USDC || quote.output.recipient !== request.recipient) malformed("quote binding");
  uint(quote.output.amount, true);
  if (canonicalJson(value).length > 262_144) malformed("quote size");
  return value as unknown as UniswapQuoteResponse;
}

export function createUniswapSwapRequest(quote: UniswapClassicQuote, deadline: number) {
  if (!Number.isSafeInteger(deadline) || deadline <= 0 || deadline > 4_294_967_295) invalid("Uniswap deadline is invalid.");
  return { quote, simulateTransaction: false as const, safetyMode: "SAFE" as const, deadline };
}

export function decodeUniswapSwapResponse(value: unknown, input: { readonly account: string; readonly amountAtomic: string;
  readonly maxGasLimit: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string }): UniswapSwapResponse {
  if (!isPlainRecord(value) || !exactKeys(value, ["requestId", "swap", "gasFee"]) || typeof value.requestId !== "string" ||
      !REQUEST_ID.test(value.requestId) || !isPlainRecord(value.swap) || typeof value.gasFee !== "string") malformed("swap response");
  const swap = value.swap, keys = Object.keys(swap);
  const base = ["from", "to", "data", "value", "gasLimit", "chainId"], eip1559 = [...base, "maxFeePerGas", "maxPriorityFeePerGas"];
  const legacy = [...base, "gasPrice"];
  if (!exactKeys(swap, keys.includes("gasPrice") ? legacy : eip1559) || swap.from !== address(input.account) || swap.to !== UNISWAP_ROUTER ||
      swap.chainId !== UNISWAP_CHAIN_ID || typeof swap.data !== "string" || !HEX.test(swap.data) || swap.data.length > 131_074 ||
      uint(swap.value, true) !== uint(input.amountAtomic, true) || uint(swap.gasLimit, true) > uint(input.maxGasLimit, true)) malformed("swap envelope");
  if (keys.includes("gasPrice")) {
    if (uint(swap.gasPrice, true) > uint(input.maxFeePerGas, true)) malformed("legacy gas cap");
  } else if (uint(swap.maxFeePerGas, true) > uint(input.maxFeePerGas, true) ||
      uint(swap.maxPriorityFeePerGas, false) > uint(input.maxPriorityFeePerGas, false) ||
      uint(swap.maxPriorityFeePerGas, false) > uint(swap.maxFeePerGas, true)) malformed("EIP-1559 gas cap");
  uint(value.gasFee, false);
  return value as unknown as UniswapSwapResponse;
}

export function uniswapRawDigest(value: unknown): string { return sha256(canonicalJson(value)); }
function address(value: unknown): string { try { if (typeof value !== "string") throw new Error(); const a = getAddress(value);
  if (a !== value || /^0x0{40}$/u.test(a)) throw new Error(); return a; } catch { return invalid("Uniswap address is invalid or non-canonical."); } }
function uint(value: unknown, positive: boolean): string { try { if (typeof value !== "string" || value.length > 78) throw new Error();
  const n = parseAtomic(value, { positive }); if (n > MAX_UINT256) throw new Error(); return n.toString(); } catch { return invalid("Uniswap integer is invalid."); } }
function malformed(part: string): never { throw new ApnError("APN_PROVIDER_PROTOCOL", `Uniswap ${part} is malformed or changed.`); }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
