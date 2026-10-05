import type { ClockPort } from "../ports.js";
import type { AssetPortfolioInput, PortfolioAccount, PortfolioNetworkResult } from "../asset-portfolio-reader.js";
import type { CandidateAsset, CandidateNetwork } from "../allowlist-inventory.js";
import type { StateStore } from "../state.js";
import { type PortfolioCapture } from "./cache-record.js";
import type { PortfolioEndpoint } from "./registry.js";
export interface PortfolioCacheContext {
    readonly state: Pick<StateStore, "loadPortfolioCache" | "writePortfolioCache">;
    readonly profileHash: string;
    readonly profileIdentity: string;
    readonly refresh?: boolean;
}
export interface PortfolioCacheMetadata {
    readonly hit: boolean;
    readonly ageMs: number;
    readonly capturedAt: string;
    readonly expiresAt: string;
    readonly sourceRpc: Pick<PortfolioNetworkResult, "mode" | "rpcCalls" | "attempts" | "methods" | "retried">;
}
interface CacheKey {
    readonly slot: string;
    readonly identity: string;
    readonly family: CandidateNetwork["family"];
    readonly assets: readonly CandidateAsset[];
}
export declare function portfolioCacheKey(context: PortfolioCacheContext, inventory: AssetPortfolioInput["inventory"], network: CandidateNetwork, assets: readonly CandidateAsset[], account: PortfolioAccount, endpoint: PortfolioEndpoint): CacheKey;
export declare function cachedPortfolio(context: PortfolioCacheContext, key: CacheKey, now: Date): Promise<(PortfolioCapture & {
    cache: PortfolioCacheMetadata;
}) | null>;
export declare function capturePortfolio(context: PortfolioCacheContext, key: CacheKey, result: PortfolioNetworkResult, clock: ClockPort): Promise<PortfolioNetworkResult>;
export {};
