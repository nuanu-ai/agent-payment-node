import type { CandidateAsset } from "../allowlist-inventory.js";
export declare const MERCHANT_URL = "https://x402engine.app/api/crypto/price?ids=bitcoin";
export declare const MERCHANT_RPC = "https://mainnet.megaeth.com/rpc";
export declare const MERCHANT_CHAIN = "eip155:4326";
export declare const MERCHANT_OWNER: `0x${string}`;
export declare const MERCHANT_TOKEN: `0x${string}`;
export declare const MERCHANT_PAYEE: `0x${string}`;
export declare const MERCHANT_AMOUNT = "1000000000000000";
export declare const MERCHANT_PROXY_HASH = "0xfdf85d183a122fe611bc878683b722b2b22633e13900c4b13767742b9f5f5a90";
export declare const MERCHANT_IMPLEMENTATION: `0x${string}`;
export declare const MERCHANT_IMPLEMENTATION_HASH = "0x781c9c39ab69e9b7d099ec75e5a28df41dc891c8fffbe0148c94ed5adc8b0c09";
export declare const MERCHANT_MECHANISM: {
    readonly provider: "x402engine-erc20-transfer-proof";
    readonly reference: "megaeth-usdm-crypto-price-v1";
};
export declare const MERCHANT_POLICY_ASSET: CandidateAsset;
/** This supplement grants no admission and cannot widen the generic x402 mechanism registry. */
export declare function merchantPolicyAsset(input: {
    chain: string;
    kind: string;
    identifier?: string;
    rail: string;
    mechanism?: unknown;
    mechanisms?: unknown;
}): CandidateAsset | undefined;
