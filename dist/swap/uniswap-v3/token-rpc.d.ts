import type { EvmRpcCall } from "../../evm-ports.js";
import { BridgeHttps } from "../../lifi/https.js";
import { type RpcReadTelemetry } from "../../lifi/rpc.js";
import type { StateStore } from "../../state.js";
import { type TokenPrimaryPoolTelemetry } from "./token-rpc-pool.js";
import type { FinalizedBatchRead } from "../../evm-finalized-proof.js";
export type TokenRpcRoute = "primary" | "archive" | "receipt";
export interface TokenRpcItem {
    readonly method: string;
    readonly params: readonly unknown[];
    readonly cachePolicy?: "auto" | "immutable" | "snapshot" | "none";
    readonly decoder: (value: unknown) => unknown;
}
export type TokenRpcCall = EvmRpcCall & {
    readonly batch?: (route: TokenRpcRoute, items: readonly TokenRpcItem[]) => Promise<readonly unknown[]>;
    readonly telemetry?: () => RpcReadTelemetry | null;
    readonly effectAttempts?: () => number;
    readonly reserveEffectSlot?: () => void;
    readonly primaryPoolTelemetry?: () => TokenPrimaryPoolTelemetry;
    readonly primaryPoolEnabled?: () => boolean;
    readonly primaryPoolSize?: () => number;
    readonly selectedPrimaryProviderId?: () => string | null;
    readonly bindPrimaryProvider?: (providerId: string | null) => Promise<void>;
    /** Whether the lane's archive setting (APN_ETHEREUM_ARCHIVE_RPC_URL, APN_BNB_ARCHIVE_RPC_URL) names an archive; without one the primary serves the block-pinned reads. */
    readonly archiveConfigured?: () => boolean;
};
export declare function tokenBatch(call: TokenRpcCall, route: TokenRpcRoute, items: readonly TokenRpcItem[]): Promise<readonly unknown[]>;
export declare function tokenChain(value: unknown): unknown;
/** The BNB Smart Chain token lane's chain identity decoder (the same check as `tokenChain`, for chain 56). */
export declare function bnbTokenChain(value: unknown): unknown;
export declare function tokenQuantity(value: unknown): unknown;
export declare function tokenHex(bytes?: number): (value: unknown) => unknown;
export declare function tokenBlock(value: unknown): unknown;
export declare function createTokenRpc(input: {
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly state: StateStore;
    readonly now: () => number;
    readonly maxHttpRequests: number;
    readonly deadlineMs: number;
    readonly maxLogicalItems?: number;
    readonly transport?: Pick<BridgeHttps, "request">;
    readonly wait?: (milliseconds: number) => Promise<void>;
    readonly pacingNow?: () => number;
}): TokenRpcCall;
/**
 * The BNB Smart Chain token lane's transport: the scalar single-primary transport over APN_BNB_RPC_URL, with
 * APN_BNB_ARCHIVE_RPC_URL and APN_BNB_RECEIPT_RPC_URL when set. The primary pool (APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS)
 * is the Ethereum lane's setting and is not read here.
 */
export declare function createBnbTokenRpc(input: TokenRpcInput): TokenRpcCall;
type TokenRpcInput = {
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly state: StateStore;
    readonly now: () => number;
    readonly maxHttpRequests: number;
    readonly deadlineMs: number;
    readonly maxLogicalItems?: number;
    readonly transport?: Pick<BridgeHttps, "request">;
    readonly wait?: (milliseconds: number) => Promise<void>;
    readonly pacingNow?: () => number;
};
/**
 * The never-lands batches through the token lane's own pool and budget: everything but the receipt in one primary batch
 * (one node answers the finalized nonce, the transaction lookup and the index probe together; the deciding batch carries
 * no chain id, so it fits the three-item bound), the receipt on its route, as the observer reads it (the receipt route's
 * shape is exactly chain id + receipt).
 */
export declare function tokenFinalizedBatch(call: TokenRpcCall): FinalizedBatchRead;
/** `tokenFinalizedBatch` of one lane: its receipt route proves the lane's own chain with `chainDecoder`. */
export declare function tokenFinalizedBatchFor(call: TokenRpcCall, chainDecoder: (value: unknown) => unknown): FinalizedBatchRead;
export {};
