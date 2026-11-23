import type { Hex } from "viem";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import type { SwapMechanismPin } from "../pin.js";
import { swapRouteDigest, swapRouteOf } from "../route-admission.js";
import { BNB_UNISWAP_TOKEN_LANE } from "../uniswap-bnb/token-lane.js";
import { BNB_UNISWAP_TOKEN_ROUTE_SCHEMA } from "../uniswap-bnb/token-route.js";
import { UNISWAP_V3_QUOTER_V2 } from "./pins.js";
import { ETHEREUM_TOKEN_NONCE_SPACE, type TokenNonceSpace } from "./token-nonce.js";
import type { UniswapTokenOperation } from "./token-operation.js";
import { tokenChain } from "./token-rpc.js";
import { createUniswapTokenRoute, encodeUniswapTokenApproval, UNISWAP_TOKEN_MECHANISM_PIN, UNISWAP_TOKEN_ROUTE_SCHEMA, UNISWAP_V3_SWAP_ROUTER,
  verifyUniswapTokenRoutePins, type UniswapTokenRoute } from "./token-route.js";
import { ethereumTokenScreen } from "./token-screen.js";

/** The asset a token-input swap pays its recipient. */
export type UniswapTokenOutputAsset = { readonly kind: "native"; readonly identifier: null } | { readonly kind: "token"; readonly identifier: string };

/**
 * One chain of the token-input Uniswap lane: exact ERC-20 approval of one pinned router, one swap, an explicit cleanup.
 * The approval, swap and cleanup state machine, custody, usage, observation and recovery are shared; everything a chain
 * decides comes from here, chosen by the record's own route schema (`tokenLaneOf`) or by the command family that builds
 * the runtime, never by a fallback to another chain. Ethereum's values reproduce its earlier pins, digests, hash
 * domains, refusals, screens and command names exactly.
 */
export interface UniswapTokenLane {
  readonly chain: "eip155:1" | "eip155:56";
  readonly chainId: 1 | 56;
  /** How a chain refusal names the chain ("… requires Ethereum chain 1."). */
  readonly chainLabel: string;
  /** The network named on screens and in archive guidance. */
  readonly networkName: string;
  readonly nativeSymbol: "ETH" | "BNB";
  /** The CLI family every next action names. */
  readonly commandPrefix: "apn swap ethereum uniswap-token" | "apn swap bnb uniswap-token";
  /** The request family of the lane's commands (`<family>.status` and so on). */
  readonly requestFamily: "swap.uniswap-token" | "swap.uniswap-bnb-token";
  readonly archiveEnvironment: "APN_ETHEREUM_ARCHIVE_RPC_URL" | "APN_BNB_ARCHIVE_RPC_URL";
  readonly quoter: `0x${string}`;
  readonly mechanismPin: SwapMechanismPin;
  readonly routeSchema: string;
  /** A chain without a base fee never includes a zero-price transaction: a zero priority fee cap refuses at quote. */
  readonly refusesZeroGasPrice: boolean;
  /** The lane's own nonce reservations: nonces of one chain never exclude another chain's. */
  readonly nonceSpace: TokenNonceSpace;
  /** The chain id decoder of every batch item that proves the chain. */
  chainDecoder(value: unknown): unknown;
  createRoute(input: { readonly inputToken: string; readonly outputToken: string; readonly recipient: string; readonly amountIn: string;
    readonly amountOutMinimum: string; readonly deadline: number }): UniswapTokenRoute;
  /** The exact ERC-20 approval of the lane's router: the route's input amount, or zero for the cleanup. */
  encodeApproval(token: string, amount: string): { readonly to: string; readonly spender: string; readonly data: Hex; readonly amount: string };
  /** The pin check of quote time and of the signing guard, at one block the command just read. */
  verifyPins(call: EvmRpcCall, tag: Hex): Promise<void>;
  inventory(): unknown;
  outputAsset(route: UniswapTokenRoute): UniswapTokenOutputAsset;
  /** The foreground approval (`cleanup` false) or cleanup screen. */
  screen(op: UniswapTokenOperation, cleanup: boolean): readonly string[];
}

export const ETHEREUM_UNISWAP_TOKEN_LANE: UniswapTokenLane = Object.freeze({
  chain: "eip155:1", chainId: 1, chainLabel: "Ethereum chain 1", networkName: "Ethereum", nativeSymbol: "ETH",
  commandPrefix: "apn swap ethereum uniswap-token", requestFamily: "swap.uniswap-token", archiveEnvironment: "APN_ETHEREUM_ARCHIVE_RPC_URL",
  quoter: UNISWAP_V3_QUOTER_V2, mechanismPin: UNISWAP_TOKEN_MECHANISM_PIN, routeSchema: UNISWAP_TOKEN_ROUTE_SCHEMA, refusesZeroGasPrice: false,
  nonceSpace: ETHEREUM_TOKEN_NONCE_SPACE, chainDecoder: tokenChain, createRoute: createUniswapTokenRoute, encodeApproval: encodeUniswapTokenApproval,
  verifyPins: verifyUniswapTokenRoutePins,
  inventory: () => ({ chain: "eip155:1", router: UNISWAP_V3_SWAP_ROUTER, pair: "USDC/USDT", fee: 100,
    mechanism: UNISWAP_TOKEN_MECHANISM_PIN, route: swapRouteOf(UNISWAP_TOKEN_MECHANISM_PIN), routeDigest: swapRouteDigest(UNISWAP_TOKEN_MECHANISM_PIN),
    approval: "exact_input_only", transactionValue: "0" }),
  outputAsset: (route: UniswapTokenRoute): UniswapTokenOutputAsset => ({ kind: "token", identifier: route.outputToken }),
  screen: ethereumTokenScreen,
} as const);

/** The lane of a validated route, by its schema. */
export function tokenLaneOf(route: Pick<UniswapTokenRoute, "schemaVersion">): UniswapTokenLane {
  if (route.schemaVersion === UNISWAP_TOKEN_ROUTE_SCHEMA) return ETHEREUM_UNISWAP_TOKEN_LANE;
  if (route.schemaVersion === BNB_UNISWAP_TOKEN_ROUTE_SCHEMA) return BNB_UNISWAP_TOKEN_LANE;
  throw new ApnError("APN_STATE_CORRUPT", "Uniswap token route names no lane.");
}

/** The lane of a token-input command (`swap.uniswap-token.*` or `swap.uniswap-bnb-token.*`). */
export function tokenLaneOfCommand(command: string): UniswapTokenLane {
  if (command.startsWith("swap.uniswap-token.")) return ETHEREUM_UNISWAP_TOKEN_LANE;
  if (command.startsWith("swap.uniswap-bnb-token.")) return BNB_UNISWAP_TOKEN_LANE;
  throw new ApnError("APN_INVALID_INPUT", "The command names no Uniswap token-input lane.");
}

/** The family commands of a token swap's lane, for `apn operation` next actions. */
export function tokenLaneCommands(lane: UniswapTokenLane): { readonly resume: string; readonly exit: string } {
  return { resume: `${lane.commandPrefix} execute --operation <operation-id>`, exit: `${lane.commandPrefix} cleanup --operation <operation-id>` };
}
