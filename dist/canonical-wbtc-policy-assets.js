import { canonicalJson } from "./canonical.js";
import { UNISWAP_WBTC_MECHANISM_PIN } from "./swap/uniswap-v3/pins.js";
/** Reviewed supplement, independent of the historical frozen dataset and its digest. No rail is admitted by listing. */
export const CANONICAL_WBTC_POLICY_ASSETS = [
    { chain: "eip155:1", networkName: "Ethereum", identifier: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
    { chain: "eip155:42161", networkName: "Arbitrum One", identifier: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f" },
].map(row => ({ ...row, family: "evm", kind: "token", symbol: "WBTC", decimals: 8, selectionClass: null,
    tokenStandard: "ERC-20", eligibility: null, rails: { direct: false, gasless: false, x402: false, bridge: false, swap: false },
    caps: null, evidence: { source: "docs/wbtc-acquisition.md; src/lifi/asset-registry.ts canonical WBTC runtime/beacon/implementation pins" },
    admission: "not_admitted_owner_configuration_missing" }));
/** Only exact WBTC deployment + exact reviewed mechanism resolves; arbitrary legacy rows and rails never do. */
export function reviewedWbtcPolicyAsset(input) {
    if (input.kind !== "token" || input.mechanisms !== undefined)
        return undefined;
    const asset = CANONICAL_WBTC_POLICY_ASSETS.find(row => row.chain === input.chain && row.identifier === input.identifier);
    if (asset === undefined)
        return undefined;
    if (input.rail === "bridge" && canonicalJson(input.mechanism ?? null) === canonicalJson({ provider: "lifi", reference: "across-v4" }))
        return asset;
    if (input.rail === "swap" && input.chain === "eip155:1" && canonicalJson(input.mechanism ?? null) === canonicalJson(UNISWAP_WBTC_MECHANISM_PIN))
        return asset;
    return undefined;
}
//# sourceMappingURL=canonical-wbtc-policy-assets.js.map