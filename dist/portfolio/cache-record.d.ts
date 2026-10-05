import type { PortfolioNetworkResult } from "../asset-portfolio-reader.js";
export declare const PORTFOLIO_CACHE_TTL_MS = 15000;
export type PortfolioCapture = Pick<PortfolioNetworkResult, "mode" | "rpcCalls" | "attempts" | "methods" | "retried" | "block" | "slot" | "observedAt" | "rows">;
export interface PortfolioCacheRecord {
    readonly schemaVersion: "apn.portfolio-cache.v1";
    readonly slot: string;
    readonly identity: string;
    readonly capturedAt: string;
    readonly expiresAt: string;
    readonly capture: PortfolioCapture;
    readonly digest: string;
}
/** Untrusted cache data is disposable; secure filesystem errors are handled by the store, not this codec. */
export declare function parsePortfolioCache(value: unknown): PortfolioCacheRecord | null;
export declare function portfolioCacheRecord(slot: string, identity: string, capture: PortfolioCapture): PortfolioCacheRecord;
