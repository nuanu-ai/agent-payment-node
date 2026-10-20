import type { Address, Hex } from "../model.js";
/**
 * x402 v2 `exact` payments with `assetTransferMethod: "permit2"`. The token and network are the owner's allowlist
 * admission (chain, token, x402 rail, this mechanism pin, caps); the contracts are verified on that chain at prepare.
 * Nothing is discovered from a seller offer alone (docs/x402-any-seller.md).
 */
export declare const PERMIT2_ADDRESS: Address;
/** x402 Foundation exact Permit2 proxy; CREATE2, the same address and runtime code on every chain. */
export declare const X402_EXACT_PERMIT2_PROXY: Address;
/** Runtime code hash of the proxy, identical on Base, Ethereum, Arbitrum, OP, Polygon, BNB, Avalanche, World, Celo and Monad (read 2026-10-20). */
export declare const X402_EXACT_PERMIT2_PROXY_CODE_HASH: Hex;
/** The owner's x402 admission must carry exactly this mechanism pin; any other pin refuses. */
export declare const X402_PERMIT2_MECHANISM: {
    readonly provider: "x402-exact-permit2";
    readonly reference: `0x${string}`;
};
export declare const ERC20_TRANSFER_TOPIC: `0x${string}`;
export declare const PROXY_SETTLED_TOPIC: `0x${string}`;
export declare const PROXY_SETTLED_WITH_PERMIT_TOPIC: `0x${string}`;
export declare const PERMIT2_TEMPLATE_CODE_HASH: Hex;
export declare function permit2DomainSeparator(chainId: number): Hex;
/** True only for the canonical Permit2 runtime deployed for exactly this chain. */
export declare function canonicalPermit2Code(code: string, chainId: number): boolean;
export interface Permit2ListAsset {
    readonly chain: `eip155:${number}`;
    readonly chainId: number;
    readonly networkName: string;
    /** Exact checksummed token contract the owner admitted. */
    readonly token: Address;
    readonly symbol: string;
    readonly decimals: number;
    /** EIP-2612 domain; needed only to sign a sponsored permit, null when the existing allowance pays. */
    readonly tokenDomain: {
        readonly name: string;
        readonly version: string;
    } | null;
    /** The token's on-chain DOMAIN_SEPARATOR, read only when a sponsored permit needs it. */
    readonly tokenDomainSeparator: Hex | null;
    readonly proxyCodeHash: Hex;
}
export type Permit2Asset = Permit2ListAsset;
/** Resolves a seller offer's (network, token) to the asset APN pays it with, or undefined when it may not. */
export type Permit2AssetResolver = (network: string, token: Address, extra: Readonly<Record<string, unknown>>) => Permit2Asset | undefined;
/**
 * The asset row of records prepared before generic admission (Avalanche USDT, released 0.5.4x). It only reconstructs
 * those records byte for byte; it admits nothing.
 */
export declare const X402_PERMIT2_ASSETS: readonly Permit2ListAsset[];
export declare function legacyPermit2Asset(chain: string, token: string): Permit2ListAsset | undefined;
/** A Permit2 offer's own (network, token) as an asset for wire-shape checks and inspect; it carries no owner admission. */
export declare const wirePermit2Asset: Permit2AssetResolver;
