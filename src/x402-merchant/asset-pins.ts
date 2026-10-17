import { getAddress } from "viem";

/**
 * EIP-1967 deployment pins of an upgradeable token. New entries carry none (PHASE2 P5): they break on every legitimate
 * upgrade, while the token address and chain, the exact signed transfer and the receipt's Transfer log bind the payment.
 * Records that stored pins (v1, and v2 written before this change) keep checking them.
 */
export interface MerchantTokenDeployment {
  readonly proxyCodeHash: string;
  readonly implementation: string;
  readonly implementationCodeHash: string;
  /** The token's own EIP-712 domain version; DOMAIN_SEPARATOR must equal the domain of (name, version, chain, token). */
  readonly domainVersion: string;
}

/**
 * One ERC-20 an x402 transfer-proof payment may use: protocol data only (chain, token address, name, symbol, decimals),
 * never a merchant, payee or amount. A challenge row naming any other asset is not payable. MegaETH is the only chain
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

/** MegaETH USDm (MegaUSD), the first entry: identified by address and chain, without code pins (owner decision 2026-10-17). */
export const MEGAETH_USDM: MerchantAssetPin = Object.freeze({
  chain: "eip155:4326", networkName: "MegaETH", token: getAddress("0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7"),
  name: "MegaUSD", symbol: "USDm", decimals: 18,
  evidence: "docs/x402-merchant-usdm.md",
});

/** The per-asset pin registry. Data only: lookups live in pins.ts. */
export const MERCHANT_ASSET_PINS: readonly MerchantAssetPin[] = Object.freeze([MEGAETH_USDM]);
