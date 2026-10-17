import { getAddress } from "viem";
/** MegaETH USDm (MegaUSD), the first entry: identified by address and chain, without code pins (owner decision 2026-10-17). */
export const MEGAETH_USDM = Object.freeze({
    chain: "eip155:4326", networkName: "MegaETH", token: getAddress("0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7"),
    name: "MegaUSD", symbol: "USDm", decimals: 18,
    evidence: "docs/x402-merchant-usdm.md",
});
/** The per-asset pin registry. Data only: lookups live in pins.ts. */
export const MERCHANT_ASSET_PINS = Object.freeze([MEGAETH_USDM]);
//# sourceMappingURL=asset-pins.js.map