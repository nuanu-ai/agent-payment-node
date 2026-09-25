import type { AllowlistInventory, CandidateAsset } from "./allowlist-inventory.js";
export declare const DIRECT_EVM_SUPPLEMENTAL_ASSETS: readonly CandidateAsset[];
export declare function directEvmSupplementalAsset(chain: string, identifier: string | null): CandidateAsset | undefined;
/** Only a direct policy admission can resolve a supplemental identity. */
export declare function resolveDirectPolicyAsset(input: {
    readonly chain: string;
    readonly kind: "native" | "token";
    readonly identifier?: string;
    readonly rail: string;
}, inventory: AllowlistInventory): CandidateAsset;
