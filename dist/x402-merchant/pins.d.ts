import type { CandidateAsset } from "../allowlist-inventory.js";
import { type MerchantAssetPin } from "./asset-pins.js";
/** MegaETH: the one chain whose transfer-proof fee model APN implements. Public keyless RPC. */
export declare const MERCHANT_RPC = "https://mainnet.megaeth.com/rpc";
export declare const MERCHANT_CHAIN = "eip155:4326";
/** The x402 ERC-20 transfer-proof mechanism. Its reference names the asset: `<chain>/<token>`. */
export declare const MERCHANT_PROVIDER = "x402-erc20-transfer-proof";
export declare function merchantAssetMechanism(asset: Pick<MerchantAssetPin, "chain" | "token">): Readonly<{
    provider: string;
    reference: string;
}>;
/** The registry entry for an exact (chain, token), or undefined. */
export declare function merchantAssetPin(chain: unknown, token: unknown, registry?: readonly MerchantAssetPin[]): MerchantAssetPin | undefined;
/**
 * Frozen legacy table (OWNR 5.3): the x402engine Bitcoin-price lane of 0.5.41-0.5.43. Version 1 operations and the
 * policies that admit them keep reading these values; a new prepare never uses the legacy mechanism.
 */
export declare const LEGACY_MERCHANT_URL = "https://x402engine.app/api/crypto/price?ids=bitcoin";
export declare const LEGACY_MERCHANT_PAYEE: `0x${string}`;
export declare const LEGACY_MERCHANT_AMOUNT = "1000000000000000";
export declare const LEGACY_MERCHANT_MECHANISM: {
    readonly provider: "x402engine-erc20-transfer-proof";
    readonly reference: "megaeth-usdm-crypto-price-v1";
};
/** USDm as v1 operations read it, with the deployment pins 0.5.41-0.5.43 checked; never used for a new prepare. */
export declare const LEGACY_MERCHANT_ASSET: MerchantAssetPin;
/** A stored v2 asset binding: the registry entry exactly as frozen at prepare. Never compared with the current registry. */
export declare function validMerchantAssetPin(value: unknown): value is MerchantAssetPin;
/**
 * Policy identity of a merchant asset and its native fee on the x402 rail, only under the exact mechanism that names it:
 * the asset's own `x402-erc20-transfer-proof` reference, or the legacy x402engine reference for USDm. Listing grants no
 * admission; the owner still stages and activates caps.
 */
export declare function merchantPolicyAsset(input: {
    chain: string;
    kind: string;
    identifier?: string;
    rail: string;
    mechanism?: unknown;
    mechanisms?: unknown;
}): CandidateAsset | undefined;
