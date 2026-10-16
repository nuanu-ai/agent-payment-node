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
export declare const MEGAETH_USDM: MerchantAssetPin;
/** The per-asset pin registry. Data only: lookups live in pins.ts. */
export declare const MERCHANT_ASSET_PINS: readonly MerchantAssetPin[];
