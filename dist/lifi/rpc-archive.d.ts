import type { BridgeChainId } from "./chains.js";
/**
 * Owner-named archive endpoints. Public full nodes prune historical state, so re-verifying an older bridge operation's
 * frozen deployment identity, L1 fee inputs, or transaction receipt needs an archive-capable reader. The operation stays
 * bound to its original RPC origin; only state reads pinned to one explicit block and exact-hash receipt reads go to this
 * endpoint, and only when the owner names it for that chain. Nothing is inferred or defaulted.
 */
export declare const BRIDGE_ARCHIVE_RPC_ENV: {
    readonly 1: "APN_ETHEREUM_ARCHIVE_RPC_URL";
    readonly 56: "APN_BNB_ARCHIVE_RPC_URL";
    readonly 143: "APN_MONAD_ARCHIVE_RPC_URL";
    readonly 8453: "APN_BASE_ARCHIVE_RPC_URL";
    readonly 42161: "APN_ARBITRUM_ARCHIVE_RPC_URL";
    readonly 59144: "APN_LINEA_ARCHIVE_RPC_URL";
};
/** Optional receipt-only readers. These never replace the operation's frozen primary RPC identity. */
export declare const BRIDGE_RECEIPT_RPC_ENV: {
    readonly 1: "APN_ETHEREUM_RECEIPT_RPC_URL";
    readonly 56: "APN_BNB_RECEIPT_RPC_URL";
    readonly 143: "APN_MONAD_RECEIPT_RPC_URL";
    readonly 8453: "APN_BASE_RECEIPT_RPC_URL";
    readonly 42161: "APN_ARBITRUM_RECEIPT_RPC_URL";
    readonly 59144: "APN_LINEA_RECEIPT_RPC_URL";
};
export interface BridgeReceiptEndpoint {
    readonly url: URL;
    /** Known provider capability. This is configuration, never a runtime probe. */
    readonly maxItemsPerRequest: 1 | 3;
}
export declare function bridgeArchiveEndpoint(chainId: BridgeChainId, environment: Readonly<Record<string, string | undefined>>): URL | null;
export declare function bridgeReceiptEndpoint(chainId: BridgeChainId, environment: Readonly<Record<string, string | undefined>>): BridgeReceiptEndpoint | null;
/** A state read pinned to one block number or block hash. Moving tags (latest, safe, finalized, pending) never qualify. */
export declare function isHistoricalStateRead(method: string, params: readonly unknown[]): boolean;
/** The complete archive surface: exact block-pinned state plus a receipt addressed by one exact transaction hash. */
export declare function isArchiveRead(method: string, params: readonly unknown[]): boolean;
