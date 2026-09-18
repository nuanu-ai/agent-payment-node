import type { Hex } from "../model.js";
/** Canonical Multicall3 deployment; used only for read-only `eth_call` aggregation in `apn wallet portfolio`. */
export declare const MULTICALL3_ADDRESS: "0xcA11bde05977b3631167028862bE2a173976CA11";
export type PortfolioFamily = "evm" | "solana" | "tron";
export interface PortfolioNetworkRpc {
    /** Exact network identity of the frozen allowlist. */
    readonly chain: string;
    readonly family: PortfolioFamily;
    /** Owner override. When set, it replaces the default endpoint for this read-only command only. */
    readonly env: string;
    /** Keyless public endpoint; its chainId (EVM) or genesis (Solana/TRON) matched live on 2026-09-18. */
    readonly defaultEndpoint: string;
    readonly evmChainId: number | null;
    readonly multicall3CodeHash: Hex | null;
}
/** Read-only portfolio endpoints. Money-moving rails never consult this registry and keep owner-named RPC only. */
export declare const PORTFOLIO_NETWORK_RPC: readonly PortfolioNetworkRpc[];
export type PortfolioEndpoint = {
    readonly source: "default_public";
    readonly env: string;
    readonly url: URL;
    readonly display: string;
} | {
    readonly source: "env";
    readonly env: string;
    readonly url: URL;
} | {
    readonly source: "invalid_env";
    readonly env: string;
} | {
    readonly source: "not_configured";
    readonly env: string | null;
};
export declare function portfolioNetworkRpc(chain: string): PortfolioNetworkRpc | undefined;
/** An empty variable counts as unset; an invalid owner value is reported, never replaced by the default. */
export declare function portfolioEndpoint(chain: string, environment: Readonly<Record<string, string | undefined>>): PortfolioEndpoint;
