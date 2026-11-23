import type { Hex } from "viem";
import type { EvmRpcCall } from "../../evm-ports.js";
import type { SwapMechanismPin } from "../pin.js";
import { type TokenNonceSpace } from "./token-nonce.js";
import type { UniswapTokenOperation } from "./token-operation.js";
import { type UniswapTokenRoute } from "./token-route.js";
/** The asset a token-input swap pays its recipient. */
export type UniswapTokenOutputAsset = {
    readonly kind: "native";
    readonly identifier: null;
} | {
    readonly kind: "token";
    readonly identifier: string;
};
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
    createRoute(input: {
        readonly inputToken: string;
        readonly outputToken: string;
        readonly recipient: string;
        readonly amountIn: string;
        readonly amountOutMinimum: string;
        readonly deadline: number;
    }): UniswapTokenRoute;
    /** The exact ERC-20 approval of the lane's router: the route's input amount, or zero for the cleanup. */
    encodeApproval(token: string, amount: string): {
        readonly to: string;
        readonly spender: string;
        readonly data: Hex;
        readonly amount: string;
    };
    /** The pin check of quote time and of the signing guard, at one block the command just read. */
    verifyPins(call: EvmRpcCall, tag: Hex): Promise<void>;
    inventory(): unknown;
    outputAsset(route: UniswapTokenRoute): UniswapTokenOutputAsset;
    /** The foreground approval (`cleanup` false) or cleanup screen. */
    screen(op: UniswapTokenOperation, cleanup: boolean): readonly string[];
}
export declare const ETHEREUM_UNISWAP_TOKEN_LANE: UniswapTokenLane;
/** The lane of a validated route, by its schema. */
export declare function tokenLaneOf(route: Pick<UniswapTokenRoute, "schemaVersion">): UniswapTokenLane;
/** The lane of a token-input command (`swap.uniswap-token.*` or `swap.uniswap-bnb-token.*`). */
export declare function tokenLaneOfCommand(command: string): UniswapTokenLane;
/** The family commands of a token swap's lane, for `apn operation` next actions. */
export declare function tokenLaneCommands(lane: UniswapTokenLane): {
    readonly resume: string;
    readonly exit: string;
};
