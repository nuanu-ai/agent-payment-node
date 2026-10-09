import type { CandidateAsset } from "./allowlist-inventory.js";
/** Reviewed supplement, independent of the historical frozen dataset and its digest. No rail is admitted by listing. */
export declare const CANONICAL_WBTC_POLICY_ASSETS: readonly CandidateAsset[];
/** Only exact WBTC deployment + exact reviewed mechanism resolves; arbitrary legacy rows and rails never do. */
export declare function reviewedWbtcPolicyAsset(input: {
    readonly chain: string;
    readonly kind: string;
    readonly identifier?: string;
    readonly rail: string;
    readonly mechanism?: unknown;
    readonly mechanisms?: unknown;
}): CandidateAsset | undefined;
