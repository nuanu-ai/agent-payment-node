import { getAddress } from "viem";

/** EIP-1967 deployment pins of an upgradeable token, checked wherever APN reads that token (prepare, approval, receipt block, retirement). */
export interface MerchantTokenDeployment {
  readonly proxyCodeHash: string;
  readonly implementation: string;
  readonly implementationCodeHash: string;
  /** The token's own EIP-712 domain version; DOMAIN_SEPARATOR must equal the domain of (name, version, chain, token). */
  readonly domainVersion: string;
}

/**
 * One ERC-20 an x402 transfer-proof payment may use: protocol data only (chain, token, identity and optional deployment
 * pins), never a merchant, payee or amount. A challenge row naming any other asset is refused. MegaETH is the only chain
 * whose fee model APN implements for this mechanism.
 */
export interface MerchantAssetPin {
  readonly chain: "eip155:4326";
  readonly networkName: "MegaETH";
  readonly token: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly deployment?: MerchantTokenDeployment;
  readonly evidence: string;
}

/** MegaETH USDm (MegaUSD), the first entry. Its proxy and implementation pins are kept, keyed by chain and token (OWNR-19). */
export const MEGAETH_USDM: MerchantAssetPin = Object.freeze({
  chain: "eip155:4326", networkName: "MegaETH", token: getAddress("0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7"),
  name: "MegaUSD", symbol: "USDm", decimals: 18,
  deployment: Object.freeze({
    proxyCodeHash: "0xfdf85d183a122fe611bc878683b722b2b22633e13900c4b13767742b9f5f5a90",
    implementation: getAddress("0xAC37677261885fDB372A37Ac8D5d47044196073C"),
    implementationCodeHash: "0x781c9c39ab69e9b7d099ec75e5a28df41dc891c8fffbe0148c94ed5adc8b0c09",
    domainVersion: "1",
  }),
  evidence: "docs/x402-merchant-usdm.md",
});

/** The per-asset pin registry. Data only: lookups live in pins.ts. */
export const MERCHANT_ASSET_PINS: readonly MerchantAssetPin[] = Object.freeze([MEGAETH_USDM]);
