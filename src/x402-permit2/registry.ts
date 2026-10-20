import { encodeAbiParameters, getAddress, keccak256, stringToHex, toHex } from "viem";
import type { Address, Hex } from "../model.js";

/**
 * x402 v2 `exact` payments with `assetTransferMethod: "permit2"`. The token and network are the owner's allowlist
 * admission (chain, token, x402 rail, this mechanism pin, caps); the contracts are verified on that chain at prepare.
 * Nothing is discovered from a seller offer alone (docs/x402-any-seller.md).
 */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
/** x402 Foundation exact Permit2 proxy; CREATE2, the same address and runtime code on every chain. */
export const X402_EXACT_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as Address;
/** Runtime code hash of the proxy, identical on Base, Ethereum, Arbitrum, OP, Polygon, BNB, Avalanche, World, Celo and Monad (read 2026-10-20). */
export const X402_EXACT_PERMIT2_PROXY_CODE_HASH = "0xce6429c0bb49284660683287c0a8fe548a88379072327d026626909d202048b9" as Hex;
/** The owner's x402 admission must carry exactly this mechanism pin; any other pin refuses. */
export const X402_PERMIT2_MECHANISM = { provider: "x402-exact-permit2", reference: X402_EXACT_PERMIT2_PROXY } as const;
/** Upper bound for the seller's timeout, which becomes the Permit2 deadline; a longer-lived signature is refused. */
export const X402_PERMIT2_MAX_TIMEOUT_SECONDS = 300;
export const ERC20_TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));
export const PROXY_SETTLED_TOPIC = keccak256(toHex("Settled()"));
export const PROXY_SETTLED_WITH_PERMIT_TOPIC = keccak256(toHex("SettledWithPermit()"));

/**
 * Canonical Permit2 runtime code differs per chain only in two 32-byte immutables: the cached chain id and the cached
 * EIP-712 domain separator. With both zeroed it hashes to one template on every chain read (10 mainnets, 2026-10-20).
 */
const PERMIT2_CODE_BYTES = 9152;
const PERMIT2_CHAIN_ID_WORD = 6945;
const PERMIT2_DOMAIN_WORD = 6983;
export const PERMIT2_TEMPLATE_CODE_HASH = "0x463331fa7a0d5f07488e42c37b461bb56a822145c161a821fbafe7d4e916b546" as Hex;
const PERMIT2_DOMAIN_TYPE = keccak256(stringToHex("EIP712Domain(string name,uint256 chainId,address verifyingContract)"));

export function permit2DomainSeparator(chainId: number): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [PERMIT2_DOMAIN_TYPE, keccak256(stringToHex("Permit2")), BigInt(chainId), PERMIT2_ADDRESS]));
}

/** True only for the canonical Permit2 runtime deployed for exactly this chain. */
export function canonicalPermit2Code(code: string, chainId: number): boolean {
  if (typeof code !== "string" || !/^0x[0-9a-fA-F]*$/u.test(code) || code.length !== 2 + PERMIT2_CODE_BYTES * 2) return false;
  const bytes = Buffer.from(code.slice(2), "hex");
  const chainWord = `0x${bytes.subarray(PERMIT2_CHAIN_ID_WORD, PERMIT2_CHAIN_ID_WORD + 32).toString("hex")}`;
  const domainWord = `0x${bytes.subarray(PERMIT2_DOMAIN_WORD, PERMIT2_DOMAIN_WORD + 32).toString("hex")}`;
  bytes.fill(0, PERMIT2_CHAIN_ID_WORD, PERMIT2_CHAIN_ID_WORD + 32);
  bytes.fill(0, PERMIT2_DOMAIN_WORD, PERMIT2_DOMAIN_WORD + 32);
  return keccak256(`0x${bytes.toString("hex")}`) === PERMIT2_TEMPLATE_CODE_HASH && BigInt(chainWord) === BigInt(chainId) &&
    domainWord === permit2DomainSeparator(chainId);
}

export interface Permit2ListAsset {
  readonly chain: `eip155:${number}`;
  readonly chainId: number;
  readonly networkName: string;
  /** Exact checksummed token contract the owner admitted. */
  readonly token: Address;
  readonly symbol: string;
  readonly decimals: number;
  /** EIP-2612 domain; needed only to sign a sponsored permit, null when the existing allowance pays. */
  readonly tokenDomain: { readonly name: string; readonly version: string } | null;
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
export const X402_PERMIT2_ASSETS: readonly Permit2ListAsset[] = [{
  chain: "eip155:43114",
  chainId: 43114,
  networkName: "Avalanche C-Chain",
  token: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" as Address,
  symbol: "USDT",
  decimals: 6,
  tokenDomain: { name: "TetherToken", version: "1" },
  tokenDomainSeparator: "0xf6d4d20bf85d69d29f5cd682e5fb2884425e4aa291bb7318e203fd68c96cc0f4" as Hex,
  proxyCodeHash: X402_EXACT_PERMIT2_PROXY_CODE_HASH,
}];

export function legacyPermit2Asset(chain: string, token: string): Permit2ListAsset | undefined {
  return X402_PERMIT2_ASSETS.find((asset) => asset.chain === chain && asset.token.toLowerCase() === token.toLowerCase());
}

/** A Permit2 offer's own (network, token) as an asset for wire-shape checks and inspect; it carries no owner admission. */
export const wirePermit2Asset: Permit2AssetResolver = (network, token, extra) => {
  const match = /^eip155:([1-9][0-9]{0,15})$/u.exec(network);
  if (match === null || !Number.isSafeInteger(Number(match[1])) || extra.assetTransferMethod !== "permit2") return undefined;
  const hints = typeof extra.name === "string" && typeof extra.version === "string" ? { name: extra.name, version: extra.version } : null;
  return { chain: network as `eip155:${number}`, chainId: Number(match[1]), networkName: network, token: getAddress(token) as Address,
    symbol: "", decimals: 0, tokenDomain: hints,
    tokenDomainSeparator: null, proxyCodeHash: X402_EXACT_PERMIT2_PROXY_CODE_HASH };
};
