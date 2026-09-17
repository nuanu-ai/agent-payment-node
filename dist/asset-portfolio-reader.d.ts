import { type AssetPolicyChainFamily, type AssetPolicyRow } from "./asset-policy-registry.js";
export interface BalanceProvenance {
    readonly block: string | null;
    readonly slot: string | null;
    readonly observedAt: string;
    readonly source: string;
    readonly attempts: number;
}
export type BalanceObservation = Readonly<{
    status: "available";
    amountAtomic: string;
    provenance: BalanceProvenance;
} | {
    status: "unavailable";
    reason: "partial_batch" | "rate_limited" | "transport" | "protocol";
    provenance: BalanceProvenance;
}>;
export interface PortfolioAssetBalance {
    readonly chain: string;
    readonly family: AssetPolicyChainFamily;
    readonly account: string;
    readonly asset: AssetPolicyRow;
    readonly observation: BalanceObservation;
}
export interface PortfolioNetworkBalance {
    readonly chain: string;
    readonly family: AssetPolicyChainFamily;
    readonly account: string;
    readonly datasetDigest: string;
    readonly cache: Readonly<{
        state: "miss" | "fresh" | "expired";
        storedAt: string;
        expiresAt: string;
        unavailableCached: boolean;
    }>;
    readonly balances: readonly PortfolioAssetBalance[];
}
export interface AssetPortfolio {
    readonly datasetDigest: string;
    readonly requestCount: number;
    readonly networks: readonly PortfolioNetworkBalance[];
}
export interface PortfolioAccount {
    readonly chain: string;
    readonly account: string;
}
export interface PortfolioCachePolicy {
    readonly availableTtlMs: number;
    /** Zero explicitly disables caching a batch containing any unavailable observation. */
    readonly unavailableTtlMs: number;
}
export interface BatchBalanceAsset {
    readonly kind: "native" | "token";
    readonly identifier: string | null;
}
export interface BatchBalanceRequest {
    readonly mode: "evm_multicall" | "solana_native_and_token_accounts" | "tron_native_and_trc20";
    readonly chain: string;
    readonly account: string;
    readonly assets: readonly BatchBalanceAsset[];
}
export interface BatchBalanceAvailable {
    readonly status: "available";
    readonly observedAt: string;
    readonly block: string | null;
    readonly slot: string | null;
    readonly balances: readonly Readonly<BatchBalanceAsset & {
        amountAtomic: string;
    }>[];
}
export interface BatchBalanceUnavailable {
    readonly status: "unavailable";
    readonly reason: "rate_limited" | "transport" | "protocol";
    readonly httpStatus?: number;
    readonly observedAt: string;
    readonly block: string | null;
    readonly slot: string | null;
}
export type BatchBalanceResult = BatchBalanceAvailable | BatchBalanceUnavailable;
export interface FamilyBalanceBatchPort {
    readonly family: AssetPolicyChainFamily;
    /** A configured implementation owns the one family-specific batch request; APN invents no deployment address. */
    readonly source: string;
    read(request: BatchBalanceRequest): Promise<BatchBalanceResult>;
}
export declare class AssetPortfolioReader {
    private readonly ports;
    private readonly now;
    private readonly wait;
    private readonly cache;
    constructor(ports: Readonly<{
        evm: FamilyBalanceBatchPort;
        solana: FamilyBalanceBatchPort;
        tron: FamilyBalanceBatchPort;
    }>, now?: () => number, wait?: (milliseconds: number) => Promise<void>);
    read(registryValue: unknown, accountsValue: unknown, cachePolicyValue: unknown): Promise<AssetPortfolio>;
    private readNetwork;
}
