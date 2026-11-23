import { getAddress } from "viem";
/**
 * Binance-Peg USDT and USDC on BNB Smart Chain. Binance, not Tether or Circle, issues them 1:1 against reserves it
 * holds, so the frozen 2026-09-17 dataset refuses them as not issuer-issued. The owner admitted both on 2026-11-23.
 * Reviewed supplement, independent of the frozen dataset and its digest: owner policies activated earlier keep their
 * binding. No rail is admitted by listing; each lane still checks its own token capabilities. Decimals, symbol and
 * name were read from the contracts on 2026-11-23.
 */
export const BINANCE_PEG_POLICY_ASSETS = [
    { identifier: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD (Binance-Peg BSC-USD)" },
    { identifier: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", name: "USD Coin (Binance-Peg USD Coin)" },
].map(row => ({
    chain: "eip155:56", family: "evm", networkName: "BNB Smart Chain", kind: "token", identifier: row.identifier,
    symbol: row.symbol, decimals: 18, selectionClass: null, tokenStandard: "BEP-20", eligibility: null,
    rails: { direct: false, gasless: false, x402: false, bridge: false, swap: false }, caps: null,
    evidence: { issuer: "Binance (Binance-Peg, 1:1 against Binance-held reserves)", name: row.name,
        source: "on-chain decimals()/symbol()/name() read 2026-11-23; owner decision 2026-11-23" },
    admission: "not_admitted_owner_configuration_missing",
}));
/**
 * One of the two deployments on eip155:56, spelled exactly as checksummed, like every frozen identity. Anything else,
 * a lowercase spelling included, falls through to the frozen resolver, which classifies it.
 */
export function binancePegPolicyAsset(chain, kind, identifier) {
    if (chain !== "eip155:56" || kind !== "token" || typeof identifier !== "string")
        return undefined;
    let canonical;
    try {
        canonical = getAddress(identifier);
    }
    catch {
        return undefined;
    }
    if (canonical !== identifier)
        return undefined;
    return BINANCE_PEG_POLICY_ASSETS.find((row) => row.identifier === canonical);
}
//# sourceMappingURL=binance-peg-policy-assets.js.map