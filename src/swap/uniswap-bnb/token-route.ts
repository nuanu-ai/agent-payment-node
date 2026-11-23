import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, type Hex } from "viem";
import { binancePegPolicyAsset } from "../../binance-peg-policy-assets.js";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex, evmRpcQuantity } from "../../evm-rpc-codec.js";
import { parseAtomic } from "../../money.js";
import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import type { UniswapV3CodePin } from "../uniswap-v3/pins.js";
import { bnbTokenChain, tokenBatch, tokenHex, type TokenRpcCall, type TokenRpcItem } from "../uniswap-v3/token-rpc.js";
import { BNB_CHAIN, BNB_UNISWAP_CODE_PINS, BNB_UNISWAP_SWAP_ROUTER_02, BNB_UNISWAP_USDC_WBNB_500, BNB_UNISWAP_USDT_WBNB_500,
  BNB_UNISWAP_V3_FACTORY, BNB_USDC, BNB_USDC_IMPLEMENTATION_PIN, BNB_USDC_IMPLEMENTATION_SLOT, BNB_USDT, BNB_WBNB } from "./pins.js";

/**
 * Token input on BNB Smart Chain: Binance-Peg USDT or USDC into native BNB, and USDT into USDC and back, exact input
 * through the pinned SwapRouter02 after an exact ERC-20 approval of that router. The router, quoter, factory, WBNB, both
 * tokens and the two WBNB pools are the native lane's pins (pins.ts). The USDT/USDC pool was read on chain 56 on
 * 2026-11-24 over https://bsc-rpc.publicnode.com, every read pinned to one block hash (EIP-1898, requireCanonical):
 *
 * - Block 135304384 (0xbdc594b5…13ac69): factory.getPool(USDT, USDC, fee) and each pool's liquidity(), slot0(), token0(),
 *   token1(), fee(), factory() and the pool's USDT and USDC balances. In-range liquidity per tier: 100 = 3.375e25
 *   (239 264 USDT, 39 671 USDC held), 500 = 5.13e24, 3000 = 6.67e22, 10000 = 2.09e21. The 0.01% pool is the deepest.
 *   The same block re-read the WBNB pools: USDT/WBNB 500 (8.86e23) and USDC/WBNB 500 (1.10e21) stay the deepest of
 *   their pairs; USDC/WBNB 500 holds only 1 609 USDC and 5.22 WBNB.
 * - Block 135304716 (0xdd847d78…71ee66): eth_getCode of every pinned contract (each hash equals its pin, the new pool's
 *   below), the USDC proxy implementation slot, decimals() of both tokens (18), SwapRouter02 and QuoterV2 factory()
 *   and WETH9(), and the factory's getPool of all three pools.
 * - Block 135304528 (0xc2064d37…c1c4b): QuoterV2 quoteExactInputSingle for 1, 10, 100, 1000 and 10000 units of input.
 *   10 USDT gave 0.017659 WBNB and 10 USDC 0.017680 WBNB (one tick crossed); 1000 USDC gave 1.7074 WBNB against
 *   1.7658 for 1000 USDT (21 ticks crossed), and 10000 USDC only 4.886 WBNB: the USDC/WBNB pool is thin. 10 USDT gave
 *   9.98996 USDC and 10 USDC 10.00804 USDT; 10000 USDT gave 9987.23 USDC (four ticks crossed).
 * - Block 135304637 (0x275c7d3a…5ebe2e): this module's calldata for 10 units of each direction, run by eth_call from an
 *   account whose token balance and router allowance were set by a state override: amountOutMinimum equal to the
 *   QuoterV2 output succeeded, quoted + 1 reverted "Too little received", a past deadline reverted "Transaction too
 *   old". eth_estimateGas under the same override: USDT to BNB 182 317, USDC to BNB 200 046, USDT to USDC 143 700, USDC
 *   to USDT 144 357; approve from a zero allowance: USDT 46 576, USDC 54 235. Both tokens' approve returns true.
 */
export const BNB_UNISWAP_USDT_USDC_100 = "0x2C3c320D49019D4f9A92352e947c7e5AcFE47D68" as const;
export const BNB_UNISWAP_USDT_USDC_100_PIN: UniswapV3CodePin = { role: "pool_usdt_usdc_100", address: BNB_UNISWAP_USDT_USDC_100,
  codeHash: "0xb64a9a26b8d4480df318b2488a78fb0dc3aab462bb97c7aff51ddfd6479c03c1" };
export const BNB_UNISWAP_TOKEN_ROUTE_SCHEMA = "apn.uniswap-v3.bnb.swap-router-02.multicall.v1" as const;
/** SwapRouter02 reads recipient 0x…01 as msg.sender and 0x…02 as the router itself (Constants.MSG_SENDER, ADDRESS_THIS). */
export const SWAP_ROUTER_02_MSG_SENDER = "0x0000000000000000000000000000000000000001" as const;
export const SWAP_ROUTER_02_ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;

/** One reviewed direction: the pool's input and output token, and whether the router unwraps the WBNB output to native BNB. */
export interface BnbUniswapTokenPair {
  readonly inputToken: typeof BNB_USDT | typeof BNB_USDC;
  readonly outputToken: typeof BNB_USDT | typeof BNB_USDC | typeof BNB_WBNB;
  readonly output: "token" | "native";
  readonly pool: typeof BNB_UNISWAP_USDT_WBNB_500 | typeof BNB_UNISWAP_USDC_WBNB_500 | typeof BNB_UNISWAP_USDT_USDC_100;
  readonly fee: 100 | 500;
  readonly inputSymbol: "USDT" | "USDC";
  readonly outputSymbol: "USDT" | "USDC" | "BNB";
}
export const BNB_UNISWAP_TOKEN_PAIRS: readonly BnbUniswapTokenPair[] = [
  { inputToken: BNB_USDT, outputToken: BNB_WBNB, output: "native", pool: BNB_UNISWAP_USDT_WBNB_500, fee: 500, inputSymbol: "USDT", outputSymbol: "BNB" },
  { inputToken: BNB_USDC, outputToken: BNB_WBNB, output: "native", pool: BNB_UNISWAP_USDC_WBNB_500, fee: 500, inputSymbol: "USDC", outputSymbol: "BNB" },
  { inputToken: BNB_USDT, outputToken: BNB_USDC, output: "token", pool: BNB_UNISWAP_USDT_USDC_100, fee: 100, inputSymbol: "USDT", outputSymbol: "USDC" },
  { inputToken: BNB_USDC, outputToken: BNB_USDT, output: "token", pool: BNB_UNISWAP_USDT_USDC_100, fee: 100, inputSymbol: "USDC", outputSymbol: "USDT" },
];

/** What the owner admits: SwapRouter02 with the factory, WBNB and the three pools it may touch (the native lane's route lists two). */
export const BNB_UNISWAP_TOKEN_MECHANISM_PIN = validateSwapMechanismPin({ schemaVersion: SWAP_MECHANISM_PIN_SCHEMA,
  protocolFamily: "uniswap_bnb", networkFamily: "evm", chain: BNB_CHAIN, protocolVersion: "swap-router-02", constructorKind: "sdk",
  constructorIdentity: "apn.uniswap-v3.bnb.swap-router-02.token-input", constructorVersion: "1.0.0",
  routerProgramIdentity: BNB_UNISWAP_SWAP_ROUTER_02,
  auxiliaryContractProgramIdentities: [BNB_UNISWAP_V3_FACTORY, BNB_WBNB, BNB_UNISWAP_USDT_WBNB_500, BNB_UNISWAP_USDC_WBNB_500, BNB_UNISWAP_USDT_USDC_100],
  quoteSchemaVersion: "quoter-v2.quote-exact-input-single.1", transactionSchemaVersion: BNB_UNISWAP_TOKEN_ROUTE_SCHEMA,
  validationPolicyIdentity: "apn.uniswap.bnb-token-v3-exact", validationPolicyVersion: "1.0.0" });

export interface BnbUniswapTokenRoute {
  readonly schemaVersion: typeof BNB_UNISWAP_TOKEN_ROUTE_SCHEMA;
  readonly inputToken: string;
  /** The token the pool pays: the output token, or WBNB when `output` is native (the router unwraps it). */
  readonly outputToken: string;
  readonly output: "token" | "native";
  readonly recipient: string;
  readonly amountIn: string;
  readonly amountOutMinimum: string;
  readonly deadline: number;
  readonly router: typeof BNB_UNISWAP_SWAP_ROUTER_02;
  readonly pool: string;
  readonly fee: 100 | 500;
  readonly calldata: Hex;
  readonly routeHash: string;
}

const ROUTER = parseAbi([
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
]);
const ERC20 = parseAbi(["function approve(address spender,uint256 amount) returns (bool)", "function decimals() view returns (uint8)"]);
const ROUTE_KEYS = ["schemaVersion", "inputToken", "outputToken", "output", "recipient", "amountIn", "amountOutMinimum", "deadline", "router",
  "pool", "fee", "calldata", "routeHash"] as const;

/** The pinned direction from `inputToken` to `output`: native BNB, or the other Binance-Peg token. */
export function bnbUniswapTokenPair(inputToken: string, output: string): BnbUniswapTokenPair {
  const pair = BNB_UNISWAP_TOKEN_PAIRS.find((row) => row.inputToken === inputToken &&
    (output === "native" ? row.output === "native" : row.output === "token" && row.outputToken === output));
  if (pair === undefined) blocked("The BNB Uniswap token direction is not pinned.", "uniswap_pair_unpinned");
  const reviewed: ReadonlyArray<readonly [string, string]> = pair.output === "token"
    ? [[pair.inputToken, pair.inputSymbol], [pair.outputToken, pair.outputSymbol]] : [[pair.inputToken, pair.inputSymbol]];
  for (const [identifier, symbol] of reviewed) {
    const asset = binancePegPolicyAsset(BNB_CHAIN, "token", identifier);
    if (asset === undefined || asset.decimals !== 18 || asset.symbol !== symbol) {
      blocked("The BNB token pin disagrees with the reviewed token's symbol or decimals.", "uniswap_bnb_decimals_mismatch");
    }
  }
  return pair;
}

/**
 * SwapRouter02 multicall(deadline, calls) with value zero. Token output: one exactInputSingle(input, output, fee,
 * recipient, amountIn, amountOutMinimum, 0). Native output: exactInputSingle(input, WBNB, 500, ADDRESS_THIS, amountIn,
 * amountOutMinimum, 0), then unwrapWETH9(amountOutMinimum, recipient): the pool pays WBNB to the router, which unwraps all
 * of it and sends that BNB to the recipient (Uniswap's own encoding of a native output). The floor binds both calls.
 */
export function createBnbUniswapTokenRoute(input: { readonly inputToken: string; readonly outputToken: string; readonly recipient: string;
  readonly amountIn: string; readonly amountOutMinimum: string; readonly deadline: number }): BnbUniswapTokenRoute {
  const pair = bnbUniswapTokenPair(token(input.inputToken), input.outputToken === "native" ? "native" : token(input.outputToken));
  const recipient = recipientOf(input.recipient), amountIn = uint(input.amountIn), amountOutMinimum = uint(input.amountOutMinimum);
  if (!Number.isSafeInteger(input.deadline) || input.deadline <= 0) invalid("Uniswap token route is invalid.");
  const swap = encodeFunctionData({ abi: ROUTER, functionName: "exactInputSingle", args: [{ tokenIn: pair.inputToken, tokenOut: pair.outputToken,
    fee: pair.fee, recipient: pair.output === "native" ? SWAP_ROUTER_02_ADDRESS_THIS : recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }] });
  const calls = pair.output === "native"
    ? [swap, encodeFunctionData({ abi: ROUTER, functionName: "unwrapWETH9", args: [amountOutMinimum, recipient] })] : [swap];
  const calldata = encodeFunctionData({ abi: ROUTER, functionName: "multicall", args: [BigInt(input.deadline), calls] });
  const body = { schemaVersion: BNB_UNISWAP_TOKEN_ROUTE_SCHEMA, inputToken: pair.inputToken, outputToken: pair.outputToken, output: pair.output,
    recipient, amountIn: amountIn.toString(), amountOutMinimum: amountOutMinimum.toString(), deadline: input.deadline,
    router: BNB_UNISWAP_SWAP_ROUTER_02, pool: pair.pool, fee: pair.fee, calldata };
  return validateBnbUniswapTokenRoute({ ...body, routeHash: domainHash(BNB_UNISWAP_TOKEN_ROUTE_SCHEMA, canonicalJson(body)) });
}

/** Every stored or created BNB route is re-derived from its own calldata by the strict decoder; any other field refuses. */
export function validateBnbUniswapTokenRoute(value: unknown): BnbUniswapTokenRoute {
  if (!isPlainRecord(value) || !exactKeys(value, [...ROUTE_KEYS])) invalid("Uniswap token route is invalid.");
  const route = value as unknown as BnbUniswapTokenRoute, expected = decodeBnbUniswapTokenCalldata(route.calldata), { routeHash, ...body } = route;
  if (canonicalJson(expected) !== canonicalJson(body) || routeHash !== domainHash(BNB_UNISWAP_TOKEN_ROUTE_SCHEMA, canonicalJson(body)))
    invalid("Uniswap token route binding changed.");
  return route;
}

/**
 * Strict SwapRouter02 proof: multicall(deadline, …) canonically encoded, holding exactly one exactInputSingle of a pinned
 * direction at its pinned fee with no price limit; a native output adds exactly one unwrapWETH9 whose floor equals the
 * swap's and pays the recipient, and its swap pays the router (ADDRESS_THIS). Anything else (a sweep, a refund, a second
 * swap, another tier, a sentinel or pinned-contract recipient) is refused.
 */
export function decodeBnbUniswapTokenCalldata(data: Hex): Omit<BnbUniswapTokenRoute, "routeHash"> {
  try {
    if (typeof data !== "string") throw new Error();
    const outer = decodeFunctionData({ abi: ROUTER, data });
    if (outer.functionName !== "multicall") throw new Error();
    const [rawDeadline, calls] = outer.args;
    if (rawDeadline <= 0n || rawDeadline > BigInt(Number.MAX_SAFE_INTEGER) || calls.length < 1 || calls.length > 2 ||
        encodeFunctionData({ abi: ROUTER, functionName: "multicall", args: [rawDeadline, calls] }).toLowerCase() !== data.toLowerCase()) throw new Error();
    const swap = decodeFunctionData({ abi: ROUTER, data: calls[0]! });
    if (swap.functionName !== "exactInputSingle") throw new Error();
    const params = swap.args[0];
    if (encodeFunctionData({ abi: ROUTER, functionName: "exactInputSingle", args: [params] }).toLowerCase() !== calls[0]!.toLowerCase()) throw new Error();
    const native = calls.length === 2, pair = BNB_UNISWAP_TOKEN_PAIRS.find((row) => row.inputToken === getAddress(params.tokenIn) &&
      row.outputToken === getAddress(params.tokenOut) && row.output === (native ? "native" : "token"));
    if (pair === undefined || params.fee !== pair.fee || params.sqrtPriceLimitX96 !== 0n) throw new Error();
    let recipient: `0x${string}` = getAddress(params.recipient);
    if (native) {
      if (recipient !== SWAP_ROUTER_02_ADDRESS_THIS) throw new Error();
      const unwrap = decodeFunctionData({ abi: ROUTER, data: calls[1]! });
      if (unwrap.functionName !== "unwrapWETH9") throw new Error();
      const [minimum, to] = unwrap.args;
      if (encodeFunctionData({ abi: ROUTER, functionName: "unwrapWETH9", args: [minimum, to] }).toLowerCase() !== calls[1]!.toLowerCase() ||
          minimum !== params.amountOutMinimum) throw new Error();
      recipient = getAddress(to);
    }
    return { schemaVersion: BNB_UNISWAP_TOKEN_ROUTE_SCHEMA, inputToken: pair.inputToken, outputToken: pair.outputToken, output: pair.output,
      recipient: recipientOf(recipient), amountIn: uint(params.amountIn.toString()).toString(),
      amountOutMinimum: uint(params.amountOutMinimum.toString()).toString(), deadline: Number(rawDeadline),
      router: BNB_UNISWAP_SWAP_ROUTER_02, pool: pair.pool, fee: pair.fee, calldata: data };
  } catch { return invalid("Uniswap SwapRouter02 token calldata is invalid."); }
}

/** The exact approval of SwapRouter02 for one Binance-Peg token; the amount is the route's input, or zero for the cleanup. */
export function encodeBnbUniswapTokenApproval(tokenAddress: string, amount: string): { readonly to: string; readonly spender: string;
  readonly data: Hex; readonly amount: string } {
  const to = token(tokenAddress), value = approvalAmount(amount);
  return { to, spender: BNB_UNISWAP_SWAP_ROUTER_02,
    data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [BNB_UNISWAP_SWAP_ROUTER_02, value] }), amount: value.toString() };
}

const pinOf = (role: string): UniswapV3CodePin => {
  const pin = BNB_UNISWAP_CODE_PINS.find((row) => row.role === role);
  if (pin === undefined) throw new ApnError("APN_STATE_CORRUPT", `BNB Uniswap ${role} pin is missing.`);
  return pin;
};
/** Every contract a token-input swap touches or authorizes: the spender, WBNB, both tokens and the three pools. */
export const BNB_UNISWAP_TOKEN_CODE_PINS: readonly UniswapV3CodePin[] = [pinOf("swap_router_02"), pinOf("wbnb"), pinOf("usdt"),
  pinOf("usdc_proxy"), pinOf("pool_usdt_wbnb_500"), pinOf("pool_usdc_wbnb_500"), BNB_UNISWAP_USDT_USDC_100_PIN];

/**
 * The lane's pin check, at quote and again by the signing guard before every approval, swap and cleanup, all at the one
 * block it just read: chain 56, the runtime code hash of every contract a swap touches (which fixes each pool's tokens,
 * fee and factory and the router's WETH9), the USDC proxy implementation and its code, and decimals() of both tokens (a
 * storage value no code hash fixes; anything but 18 refuses). Twelve reads in four provider-compatible batches.
 */
export async function verifyBnbUniswapTokenRoutePins(call: EvmRpcCall, tag: Hex): Promise<void> {
  const rpc = call as TokenRpcCall, [router, wbnb, usdt, usdc, poolUsdtWbnb, poolUsdcWbnb, poolUsdtUsdc] = BNB_UNISWAP_TOKEN_CODE_PINS;
  const first = await tokenBatch(rpc, "archive", [
    { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: bnbTokenChain }, code(router!, tag), code(wbnb!, tag)]);
  if (evmRpcQuantity(first[0]) !== 56n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token archive requires BNB Smart Chain chain 56.");
  verify(first[1], router!); verify(first[2], wbnb!);
  const second = await tokenBatch(rpc, "archive", [code(usdt!, tag), code(usdc!, tag),
    { method: "eth_getStorageAt", params: [BNB_USDC, BNB_USDC_IMPLEMENTATION_SLOT, tag], cachePolicy: "immutable", decoder: tokenHex(32) }]);
  verify(second[0], usdt!); verify(second[1], usdc!);
  const word = evmRpcHex(second[2], 32);
  if (!/^0x0{24}/u.test(word) || getAddress(`0x${word.slice(26)}`) !== BNB_USDC_IMPLEMENTATION_PIN.address) {
    blocked("The Binance-Peg USDC proxy implementation changed from its pinned address.", "uniswap_code_pin_drift");
  }
  const third = await tokenBatch(rpc, "archive", [code(BNB_USDC_IMPLEMENTATION_PIN, tag), decimals(BNB_USDT, tag), decimals(BNB_USDC, tag)]);
  verify(third[0], BNB_USDC_IMPLEMENTATION_PIN);
  for (const [value, symbol] of [[third[1], "USDT"], [third[2], "USDC"]] as const) {
    if (decodeFunctionResult({ abi: ERC20, functionName: "decimals", data: evmRpcHex(value, 32) }) !== 18) {
      blocked(`On-chain ${symbol} decimals differ from the pinned 18.`, "uniswap_bnb_decimals_mismatch");
    }
  }
  const pools = await tokenBatch(rpc, "archive", [code(poolUsdtWbnb!, tag), code(poolUsdcWbnb!, tag), code(poolUsdtUsdc!, tag)]);
  verify(pools[0], poolUsdtWbnb!); verify(pools[1], poolUsdcWbnb!); verify(pools[2], poolUsdtUsdc!);
}
function code(pin: UniswapV3CodePin, tag: Hex): TokenRpcItem {
  return { method: "eth_getCode", params: [pin.address, tag], cachePolicy: "immutable", decoder: tokenHex() };
}
function decimals(tokenAddress: string, tag: Hex): TokenRpcItem {
  return { method: "eth_call", params: [{ to: tokenAddress, data: encodeFunctionData({ abi: ERC20, functionName: "decimals" }) }, tag],
    cachePolicy: "immutable", decoder: (value: unknown) => { decodeFunctionResult({ abi: ERC20, functionName: "decimals", data: evmRpcHex(value, 32) }); return value; } };
}
function verify(value: unknown, pin: UniswapV3CodePin): void {
  if (keccak256(evmRpcHex(value)) !== pin.codeHash) blocked("Uniswap token route code pin changed.", "uniswap_code_pin_drift");
}

/** The two Binance-Peg tokens only, spelled exactly as checksummed. */
function token(value: string): typeof BNB_USDT | typeof BNB_USDC {
  const canonical = address(value);
  if (canonical === BNB_USDT || canonical === BNB_USDC) return canonical;
  return invalid("Only Binance-Peg USDT and USDC of BNB Smart Chain are admitted.");
}
/** An account: not the zero address, a router sentinel, the router itself or WBNB, where the output would be lost or sweepable. */
function recipientOf(value: string): `0x${string}` {
  const recipient = address(value);
  if (recipient === SWAP_ROUTER_02_MSG_SENDER || recipient === SWAP_ROUTER_02_ADDRESS_THIS || recipient === BNB_UNISWAP_SWAP_ROUTER_02 || recipient === BNB_WBNB) {
    invalid("BNB Uniswap recipient must be an account, not a router sentinel or a pinned contract.");
  }
  return recipient;
}
function address(value: string): `0x${string}` {
  try { const canonical = getAddress(value); if (canonical !== value || /^0x0{40}$/u.test(canonical)) throw new Error(); return canonical; }
  catch { return invalid("Uniswap address is invalid."); }
}
function uint(value: string): bigint { try { return parseAtomic(value, { positive: true }); } catch { return invalid("Uniswap amount is invalid."); } }
function approvalAmount(value: string): bigint { try { return parseAtomic(value); } catch { return invalid("Uniswap approval amount is invalid."); } }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
