import type { AllowlistInventory, CandidateAsset } from "./allowlist-inventory.js";
export declare const DIRECT_EVM_SUPPLEMENTAL_ASSETS: readonly CandidateAsset[];
export declare function directEvmSupplementalAsset(chain: string, identifier: string | null): CandidateAsset | undefined;
/**
 * A policy admission's asset: merchant pins and reviewed WBTC by their exact mechanism, the Binance-Peg USDT and USDC of
 * BNB Smart Chain on any rail, the direct-only supplements on the direct rail only, and otherwise the frozen inventory.
 */
export declare function resolveDirectPolicyAsset(input: {
    readonly chain: string;
    readonly kind: "native" | "token";
    readonly identifier?: string;
    readonly rail: string;
    readonly mechanism?: unknown;
    readonly mechanisms?: unknown;
}, inventory: AllowlistInventory): CandidateAsset;
