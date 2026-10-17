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
};
export declare function tokenBatch(call: TokenRpcCall, route: TokenRpcRoute, items: readonly TokenRpcItem[]): Promise<readonly unknown[]>;
export declare function tokenChain(value: unknown): unknown;
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
 * The never-lands batch through the token lane's own pool and budget: everything but the receipt in one primary batch
 * (one node answers the finalized nonce and the transaction lookup together), the receipt on its route, as the observer
 * reads it (the receipt route's shape is exactly chain id + receipt).
 */
export declare function tokenFinalizedBatch(call: TokenRpcCall): FinalizedBatchRead;
