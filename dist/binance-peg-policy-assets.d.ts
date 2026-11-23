import type { CandidateAsset } from "./allowlist-inventory.js";
/**
 * Binance-Peg USDT and USDC on BNB Smart Chain. Binance, not Tether or Circle, issues them 1:1 against reserves it
 * holds, so the frozen 2026-09-17 dataset refuses them as not issuer-issued. The owner admitted both on 2026-11-23.
 * Reviewed supplement, independent of the frozen dataset and its digest: owner policies activated earlier keep their
 * binding. No rail is admitted by listing; each lane still checks its own token capabilities. Decimals, symbol and
 * name were read from the contracts on 2026-11-23.
 */
export declare const BINANCE_PEG_POLICY_ASSETS: readonly CandidateAsset[];
/**
 * One of the two deployments on eip155:56, spelled exactly as checksummed, like every frozen identity. Anything else,
 * a lowercase spelling included, falls through to the frozen resolver, which classifies it.
 */
export declare function binancePegPolicyAsset(chain: string, kind: string, identifier: string | null | undefined): CandidateAsset | undefined;
