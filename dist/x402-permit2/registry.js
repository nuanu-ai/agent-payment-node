import { keccak256, toHex } from "viem";
/**
 * x402 v2 `exact` payments with `assetTransferMethod: "permit2"` for list tokens that have no EIP-3009.
 * Every identity here is pinned from read-only chain and facilitator evidence (docs/x402-non-usdc.md);
 * nothing is discovered from a seller offer.
 */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
/** x402 Foundation exact Permit2 proxy; CREATE2, the same address and runtime code on every admitted chain. */
export const X402_EXACT_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001";
/** The owner's x402 admission must carry exactly this mechanism pin; any other pin refuses. */
export const X402_PERMIT2_MECHANISM = { provider: "x402-exact-permit2", reference: X402_EXACT_PERMIT2_PROXY };
/** Upper bound for the seller's timeout, which becomes the Permit2 deadline; a longer-lived signature is refused. */
export const X402_PERMIT2_MAX_TIMEOUT_SECONDS = 300;
export const ERC20_TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));
export const PROXY_SETTLED_TOPIC = keccak256(toHex("Settled()"));
export const PROXY_SETTLED_WITH_PERMIT_TOPIC = keccak256(toHex("SettledWithPermit()"));
/** Admitted: Avalanche USDT has EIP-2612 permit, the proxy is deployed, and PayAI verifies the Permit2 payload keylessly. */
export const X402_PERMIT2_ASSETS = [{
        chain: "eip155:43114",
        chainId: 43114,
        networkName: "Avalanche C-Chain",
        token: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
        symbol: "USDT",
        decimals: 6,
        tokenDomain: { name: "TetherToken", version: "1" },
        tokenDomainSeparator: "0xf6d4d20bf85d69d29f5cd682e5fb2884425e4aa291bb7318e203fd68c96cc0f4",
        proxyCodeHash: "0xce6429c0bb49284660683287c0a8fe548a88379072327d026626909d202048b9",
    }];
/**
 * List tokens deliberately refused with a precise reason. Ethereum USDT has neither EIP-2612 nor EIP-3009, and no
 * keyless public facilitator settles eip155:1 (PayAI answers `invalid_network`; x402.org is testnet-only for EVM).
 */
export const X402_PERMIT2_BLOCKED = [
    { chain: "eip155:1", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", reason: "x402_permit2_facilitator_unavailable" },
];
export function permit2ListAsset(chain) {
    return X402_PERMIT2_ASSETS.find((asset) => asset.chain === chain);
}
//# sourceMappingURL=registry.js.map