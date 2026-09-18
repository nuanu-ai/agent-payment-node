import type { AllowlistInventory } from "./allowlist-inventory.js";
import type { PortfolioEndpoint, PortfolioFamily } from "./portfolio/registry.js";
export declare const PORTFOLIO_MAX_ATTEMPTS = 3;
/** Pause before attempt 2 and attempt 3. */
export declare const PORTFOLIO_RETRY_PAUSES_MS: readonly number[];
export type PortfolioRetryableReason = "rate_limited" | "server_error" | "timeout" | "unreachable";
export type BatchUnavailableReason = PortfolioRetryableReason | "http_status" | "rpc_error" | "protocol" | "chain_mismatch" | "multicall_code_mismatch" | "transport_refused";
export type PortfolioUnavailableReason = BatchUnavailableReason | "partial_batch" | "rpc_config_invalid" | "external_provider_profile";
export type PortfolioRowStatus = "ok" | "unavailable" | "no_account" | "rpc_not_configured";
export type PortfolioAccount = {
    readonly kind: "account";
    readonly address: string;
} | {
    readonly kind: "none";
} | {
    readonly kind: "unsupported";
    readonly reason: "external_provider_profile";
};
export interface BatchBalanceAsset {
    readonly kind: "native" | "token";
    readonly identifier: string | null;
}
export interface BatchBalanceRequest {
    readonly chain: string;
    readonly family: PortfolioFamily;
    readonly account: string;
    /** Validated HTTPS endpoint (serialized URL). */
    readonly endpoint: string;
    readonly assets: readonly BatchBalanceAsset[];
}
export type BatchBalanceMode = "evm_multicall3_aggregate3" | "evm_json_rpc_batch" | "solana_json_rpc_batch" | "tron_http_sequential";
export type BatchBalanceRow = BatchBalanceAsset & ({
    readonly amountAtomic: string;
} | {
    readonly unavailable: "partial_batch" | "protocol";
});
interface BatchCost {
    readonly mode: BatchBalanceMode;
    /** HTTP requests sent during this attempt. One JSON-RPC batch array counts as one call. */
    readonly calls: number;
    /** JSON-RPC methods or TRON API paths carried by those calls. */
    readonly methods: number;
}
export type BatchBalanceAvailable = BatchCost & {
    readonly status: "available";
    readonly block: string | null;
    readonly slot: string | null;
    readonly balances: readonly BatchBalanceRow[];
};
export type BatchBalanceUnavailable = BatchCost & {
    readonly status: "unavailable";
    readonly reason: BatchUnavailableReason;
    readonly httpStatus?: number;
};
export type BatchBalanceResult = BatchBalanceAvailable | BatchBalanceUnavailable;
/** A family port performs one attempt and never throws; the reader owns retries and never turns failure into zero. */
export interface FamilyBalanceBatchPort {
    readonly family: PortfolioFamily;
    read(request: BatchBalanceRequest): Promise<BatchBalanceResult>;
}
export interface PortfolioRow {
    readonly symbol: string;
    readonly kind: "native" | "token";
    readonly contract: string | null;
    readonly decimals: number;
    readonly status: PortfolioRowStatus;
    readonly atomic: string | null;
    readonly display: string | null;
    readonly reason: PortfolioUnavailableReason | null;
    readonly httpStatus: number | null;
}
export interface PortfolioNetworkResult {
    readonly chain: string;
    readonly name: string;
    readonly family: PortfolioFamily;
    readonly account: string | null;
    readonly endpoint: Readonly<{
        source: PortfolioEndpoint["source"];
        env: string | null;
        url: string | null;
    }>;
    readonly mode: BatchBalanceMode | null;
    readonly rpcCalls: number;
    readonly attempts: number;
    /** Classified failure of every attempt that was retried, in order. */
    readonly retried: readonly PortfolioRetryableReason[];
    readonly methods: number;
    readonly block: string | null;
    readonly slot: string | null;
    readonly observedAt: string | null;
    readonly rows: readonly PortfolioRow[];
}
export interface AssetPortfolio {
    readonly datasetVersion: string;
    readonly datasetSha256: string;
    readonly rpcCallsTotal: number;
    readonly networks: readonly PortfolioNetworkResult[];
}
export interface AssetPortfolioInput {
    readonly inventory: AllowlistInventory;
    readonly accounts: Readonly<Record<PortfolioFamily, PortfolioAccount>>;
    readonly endpoint: (chain: string) => PortfolioEndpoint;
}
type Ports = Readonly<Record<PortfolioFamily, FamilyBalanceBatchPort>>;
export declare class AssetPortfolioReader {
    private readonly now;
    private readonly wait;
    private readonly ports;
    /** `wait` resolves "interrupted" to end retries early; the last classified result is then reported. */
    constructor(ports: Ports, now: () => Date, wait: (milliseconds: number) => Promise<"elapsed" | "interrupted">);
    /** Reads every network of the frozen list concurrently; each network is one batch attempt plus bounded retries. */
    read(input: AssetPortfolioInput): Promise<AssetPortfolio>;
    private readNetwork;
    private attempt;
}
export {};
