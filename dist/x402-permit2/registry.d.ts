import type { Address, Hex } from "../model.js";
/**
 * x402 v2 `exact` payments with `assetTransferMethod: "permit2"` for list tokens that have no EIP-3009.
 * Every identity here is pinned from read-only chain and facilitator evidence (docs/x402-non-usdc.md);
 * nothing is discovered from a seller offer.
 */
export declare const PERMIT2_ADDRESS: Address;
/** Canonical Permit2 runtime hash observed on Avalanche in the frozen chain probe. */
export declare const PERMIT2_CODE_HASH: Hex;
/** x402 Foundation exact Permit2 proxy; CREATE2, the same address and runtime code on every admitted chain. */
export declare const X402_EXACT_PERMIT2_PROXY: Address;
/** The owner's x402 admission must carry exactly this mechanism pin; any other pin refuses. */
export declare const X402_PERMIT2_MECHANISM: {
    readonly provider: "x402-exact-permit2";
    readonly reference: `0x${string}`;
};
/** Upper bound for the seller's timeout, which becomes the Permit2 deadline; a longer-lived signature is refused. */
export declare const X402_PERMIT2_MAX_TIMEOUT_SECONDS = 300;
export declare const ERC20_TRANSFER_TOPIC: `0x${string}`;
export declare const PROXY_SETTLED_TOPIC: `0x${string}`;
export declare const PROXY_SETTLED_WITH_PERMIT_TOPIC: `0x${string}`;
export interface Permit2ListAsset {
    readonly chain: `eip155:${number}`;
    readonly chainId: number;
    readonly networkName: string;
    /** Exact checksummed list identifier from the frozen 2026-09-17 allowlist dataset. */
    readonly token: Address;
    readonly symbol: "USDT";
    readonly decimals: 6;
    /** EIP-2612 domain proven by recomputing the on-chain DOMAIN_SEPARATOR. */
    readonly tokenDomain: {
        readonly name: string;
        readonly version: string;
    };
    readonly tokenDomainSeparator: Hex;
    readonly proxyCodeHash: Hex;
}
/** Admitted: Avalanche USDT has EIP-2612 permit, the proxy is deployed, and PayAI verifies the Permit2 payload keylessly. */
export declare const X402_PERMIT2_ASSETS: readonly Permit2ListAsset[];
/**
 * List tokens deliberately refused with a precise reason. Ethereum USDT has neither EIP-2612 nor EIP-3009, and no
 * keyless public facilitator settles eip155:1 (PayAI answers `invalid_network`; x402.org is testnet-only for EVM).
 */
export declare const X402_PERMIT2_BLOCKED: readonly {
    readonly chain: string;
    readonly token: Address;
    readonly reason: "x402_permit2_facilitator_unavailable";
}[];
export declare function permit2ListAsset(chain: unknown): Permit2ListAsset | undefined;
