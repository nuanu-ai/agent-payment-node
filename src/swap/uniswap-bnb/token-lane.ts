import { ApnError } from "../../errors.js";
import { swapRouteDigest, swapRouteOf } from "../route-admission.js";
import type { UniswapTokenLane, UniswapTokenOutputAsset } from "../uniswap-v3/token-lane.js";
import { BNB_TOKEN_NONCE_SPACE } from "../uniswap-v3/token-nonce.js";
import type { UniswapTokenOperation } from "../uniswap-v3/token-operation.js";
import type { UniswapTokenRoute } from "../uniswap-v3/token-route.js";
import { bnbTokenChain } from "../uniswap-v3/token-rpc.js";
import { BNB_CHAIN, BNB_UNISWAP_QUOTER_V2, BNB_UNISWAP_SWAP_ROUTER_02, BNB_USDC, BNB_USDC_IMPLEMENTATION_PIN, BNB_USDT } from "./pins.js";
import { BNB_UNISWAP_TOKEN_CODE_PINS, BNB_UNISWAP_TOKEN_MECHANISM_PIN, BNB_UNISWAP_TOKEN_PAIRS, BNB_UNISWAP_TOKEN_ROUTE_SCHEMA,
  createBnbUniswapTokenRoute, encodeBnbUniswapTokenApproval, verifyBnbUniswapTokenRoutePins } from "./token-route.js";

/**
 * BNB Smart Chain token input: Binance-Peg USDT or USDC into native BNB, and USDT into USDC and back, through the pinned
 * SwapRouter02 over APN_BNB_RPC_URL. Its own pins, route schema, mechanism pin, nonce space and command family
 * (`apn swap bnb uniswap-token`); the approval, swap and cleanup rules are the Ethereum token lane's.
 */
export const BNB_UNISWAP_TOKEN_LANE: UniswapTokenLane = Object.freeze({
  chain: BNB_CHAIN, chainId: 56, chainLabel: "BNB Smart Chain chain 56", networkName: "BNB Smart Chain", nativeSymbol: "BNB",
  commandPrefix: "apn swap bnb uniswap-token", requestFamily: "swap.uniswap-bnb-token", archiveEnvironment: "APN_BNB_ARCHIVE_RPC_URL",
  quoter: BNB_UNISWAP_QUOTER_V2, mechanismPin: BNB_UNISWAP_TOKEN_MECHANISM_PIN, routeSchema: BNB_UNISWAP_TOKEN_ROUTE_SCHEMA,
  refusesZeroGasPrice: true, nonceSpace: BNB_TOKEN_NONCE_SPACE, chainDecoder: bnbTokenChain, createRoute: createBnbUniswapTokenRoute,
  encodeApproval: encodeBnbUniswapTokenApproval, verifyPins: verifyBnbUniswapTokenRoutePins,
  inventory: () => ({ chain: BNB_CHAIN, router: BNB_UNISWAP_SWAP_ROUTER_02, routerLabel: "SwapRouter02", quoter: BNB_UNISWAP_QUOTER_V2,
    pairs: BNB_UNISWAP_TOKEN_PAIRS.map((row) => ({ inputToken: row.inputToken, inputSymbol: row.inputSymbol,
      output: row.output === "native" ? "native" : row.outputToken, outputSymbol: row.outputSymbol, pool: row.pool, fee: row.fee,
      unwrapsWbnb: row.output === "native" })), decimals: 18, mechanism: BNB_UNISWAP_TOKEN_MECHANISM_PIN,
    route: swapRouteOf(BNB_UNISWAP_TOKEN_MECHANISM_PIN), routeDigest: swapRouteDigest(BNB_UNISWAP_TOKEN_MECHANISM_PIN),
    codePins: [...BNB_UNISWAP_TOKEN_CODE_PINS, BNB_USDC_IMPLEMENTATION_PIN], approval: "exact_input_only", transactionValue: "0",
    rpc: "APN_BNB_RPC_URL" }),
  outputAsset: bnbOutputAsset,
  screen: bnbTokenScreen,
} as const);

function bnbOutputAsset(route: UniswapTokenRoute): UniswapTokenOutputAsset {
  return "output" in route && route.output === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: route.outputToken };
}

/** The BNB screens name the network, each token's symbol and 18 decimals, the pool, and native BNB where the router unwraps. */
function bnbTokenScreen(op: UniswapTokenOperation, cleanup: boolean): readonly string[] {
  const route = op.route, native = bnbOutputAsset(route).kind === "native";
  if (cleanup) return ["Agent Payment Node Uniswap token allowance cleanup (BNB Smart Chain)", `Profile: ${op.profile}`, `Operation: ${op.operationId}`,
    `Token/spender: ${symbol(route.inputToken)} ${route.inputToken} / ${route.router}`, "Replacement allowance: 0",
    `Reason: ${op.cleanupReason ?? "residual_allowance"}`,
    `Native debit so far: ${op.accumulatedNativeDebitWei} wei of BNB; aggregate cap with this cleanup: ${op.maximumNativeDebitWei} wei of BNB`,
    ...(op.cleanupFeeQuote === undefined ? [] : [`Cleanup fee caps re-quoted by the owner at BNB Smart Chain block ${op.cleanupFeeQuote.blockNumber} (base fee ${op.cleanupFeeQuote.baseFeePerGasWei} wei, priority fee ${op.cleanupFeeQuote.priorityFeePerGasWei} wei)`,
      `Cleanup max fee per gas: ${op.cleanupGas.maxFeePerGas} wei (frozen: ${op.cleanupFeeQuote.previousCleanupGas.maxFeePerGas}); max priority fee: ${op.cleanupGas.maxPriorityFeePerGas} wei (frozen: ${op.cleanupFeeQuote.previousCleanupGas.maxPriorityFeePerGas}); gas limit ${op.cleanupGas.gasLimit}`,
      `Native debit cap: ${op.maximumNativeDebitWei} wei of BNB (was ${op.cleanupFeeQuote.previousMaximumNativeDebitWei})`]),
    ...(op.retiredEffects ?? []).filter((row) => row.kind === "cleanup").map((row) => `Earlier cleanup ${row.attempt.transactionHash}: ${row.reason}`)];
  return ["Agent Payment Node Uniswap V3 token swap approval (BNB Smart Chain)", `Profile: ${op.profile}`, `Operation: ${op.operationId}`,
    `Signer: ${op.account}`, `Network: BNB Smart Chain (${BNB_CHAIN})`,
    `Exact input: ${route.amountIn} atomic (18 decimals) of ${symbol(route.inputToken)} ${route.inputToken}`,
    native ? `Minimum output: ${route.amountOutMinimum} wei of native BNB (the router unwraps WBNB ${route.outputToken})`
      : `Minimum output: ${route.amountOutMinimum} atomic (18 decimals) of ${symbol(route.outputToken)} ${route.outputToken}`,
    `Recipient: ${route.recipient}`, `Router: ${route.router} (SwapRouter02); pool ${route.pool}, fee ${route.fee}`,
    `Exact approval cap: ${op.approvalCapAtomic}`, `Aggregate native debit cap: ${op.maximumNativeDebitWei} wei of BNB`,
    `Deadline: ${new Date(route.deadline * 1000).toISOString()}`,
    "Approval, swap, and any explicit cleanup are independently signed and broadcast at most once."];
}
/** A validated BNB route pays in and out only Binance-Peg USDT and USDC (or native BNB, named on its own line). */
function symbol(token: string): "USDT" | "USDC" {
  if (token === BNB_USDT) return "USDT";
  if (token === BNB_USDC) return "USDC";
  throw new ApnError("APN_STATE_CORRUPT", "BNB Uniswap token route names an unpinned token.");
}
