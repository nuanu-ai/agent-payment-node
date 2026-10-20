import { getAddress } from "viem";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { BASE_USDC } from "./constants.js";
import { ApnError } from "./errors.js";
import type { Address } from "./model.js";
import type { ProfilePolicyBinding } from "./profile-policy.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalProfile } from "./wallet-policy.js";

export type X402ChainText = `${number}`;
export type X402Network = `eip155:${number}`;
export interface X402PolicyNetwork { readonly chainId: number; readonly token: Address }
/** The block tag every x402 EIP-3009 proof of an operation reads; frozen in the record at prepare. */
export type X402ProofTag = "safe" | "finalized";

/**
 * One EVM network and token a standard x402 purchase pays in. Nothing here admits it: the owner's profile x402 policy
 * for exactly this chain and token does, and prepare proves the token's EIP-3009 identity on that chain.
 */
export interface X402Asset {
  readonly chainId: number;
  readonly chainText: X402ChainText;
  readonly network: X402Network;
  /** EIP-55 checksummed token contract. */
  readonly token: Address;
  readonly proofTag: X402ProofTag;
}

/**
 * The released spelling of `--chain` without `--asset`: USDC on the three networks APN shipped x402 on. It never admits
 * anything by itself, and on any other chain the token must be named.
 */
const RELEASED_USDC: Readonly<Record<number, Address>> = Object.freeze({
  8453: BASE_USDC,
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
});
/** Chains where released APN proves x402 settlement at `safe`; every other chain proves at `finalized`, the stronger tag. */
const SAFE_PROOF_CHAINS: readonly number[] = Object.freeze([8453, 1, 42161]);
const CHAIN_TEXT = /^[1-9][0-9]{0,15}$/u;
const LOWER_TOKEN = /^0x[0-9a-f]{40}$/u;
const ZERO = "0x0000000000000000000000000000000000000000";

/** An EVM chain by number or exact `eip155:<id>`; the RPC's eth_chainId must later equal it. */
export function x402Chain(value: unknown): number {
  const text = typeof value === "number" ? String(value) : typeof value === "string" && value.startsWith("eip155:") ? value.slice(7) : null;
  const chainId = text !== null && CHAIN_TEXT.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw new ApnError("APN_INVALID_INPUT", "Select an EVM network by its exact CAIP-2 identity eip155:<chain id>.");
  }
  return chainId;
}

export function x402ProofTag(chainId: number): X402ProofTag {
  return SAFE_PROOF_CHAINS.includes(chainId) ? "safe" : "finalized";
}

/** The selected network and token; without a token only the released USDC spelling of Base, Ethereum or Arbitrum. */
export function x402Asset(chain: unknown = 8453, token?: unknown): X402Asset {
  const chainId = x402Chain(chain);
  let selected: Address;
  if (token === undefined) {
    const released = RELEASED_USDC[chainId];
    if (released === undefined) {
      throw new ApnError("APN_INVALID_INPUT", `Name the token for eip155:${chainId} with --asset; no token is implied on this network.`,
        { reason: "x402_asset_required", chain: `eip155:${chainId}` });
    }
    selected = released;
  } else {
    if (typeof token !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(token)) throw new ApnError("APN_INVALID_INPUT", "The x402 asset must be an exact ERC-20 contract address.");
    try { selected = getAddress(token) as Address; } catch { throw new ApnError("APN_INVALID_INPUT", "The x402 asset address checksum is invalid."); }
    if (selected === ZERO) throw new ApnError("APN_INVALID_INPUT", "The zero address is not an ERC-20 contract.");
  }
  return { chainId, chainText: `${chainId}` as X402ChainText, network: `eip155:${chainId}` as X402Network, token: selected, proofTag: x402ProofTag(chainId) };
}

/** The legacy accessor of the released USDC spelling (`x402Asset` without a token). */
export function x402Network(value: unknown = 8453): X402Asset { return x402Asset(value); }

/** The asset a stored record names, from its own network and token fields. */
export function x402AssetOf(record: { readonly network: string; readonly token: string }): X402Asset {
  return x402Asset(record.network, record.token);
}

/** True for the three (network, USDC) pairs APN released x402 on; their records, hashes and policies keep the old shape. */
export function releasedX402Pair(chainId: number | string, token: string): boolean {
  const released = RELEASED_USDC[Number(chainId)];
  return released !== undefined && released.toLowerCase() === token.toLowerCase();
}

export function isBaseUsdc(asset: { readonly chainId: number; readonly token: string }): boolean {
  return asset.chainId === 8453 && asset.token.toLowerCase() === BASE_USDC.toLowerCase();
}

/** A stored (chainId, network, token) triple is consistent with itself: canonical chain text, CAIP-2 and lowercase token. */
export function validX402Tuple(chain: unknown, network: unknown, token: unknown): boolean {
  return typeof chain === "string" && CHAIN_TEXT.test(chain) && Number.isSafeInteger(Number(chain)) && network === `eip155:${chain}` &&
    typeof token === "string" && LOWER_TOKEN.test(token) && token !== ZERO;
}

export function validPolicyNetwork(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isPlainRecord(value) || !exactKeys(value, ["chainId", "token"])) return false;
  try {
    const selected = x402Asset(value.chainId, value.token);
    return value.chainId === selected.chainId && value.token === selected.token && !isBaseUsdc(selected);
  } catch { return false; }
}

/** Base USDC keeps the original no-network policy record; every other chain or token has its own. */
export function networkPolicyBinding(binding: ProfilePolicyBinding, selection: X402Asset | number = 8453): ProfilePolicyBinding {
  const selected = typeof selection === "number" ? x402Asset(selection) : selection;
  return isBaseUsdc(selected) ? binding : { ...binding, x402Network: { chainId: selected.chainId, token: selected.token } };
}

export function policyStorageIdentity(binding: ProfilePolicyBinding): string {
  canonicalProfile(binding.profile);
  if (!validPolicyNetwork(binding.x402Network)) throw new ApnError("APN_STATE_CORRUPT", "Policy network binding is invalid.");
  return binding.x402Network === undefined ? binding.profile : `~network~${binding.x402Network.chainId}~${binding.x402Network.token.toLowerCase()}~${binding.profile}`;
}

/** External wallet profiles pay only Base USDC; every other network or token needs a local profile. */
export async function assertLocalNetworkProfile(context: RuntimeContext, profile: string, selection: X402Asset | number = 8453): Promise<void> {
  if (typeof selection === "number" ? x402Chain(selection) === 8453 : isBaseUsdc(selection)) return;
  const provider = await context.profileRepository?.load(context.state.profileHash(canonicalProfile(profile)));
  if (provider !== undefined && provider !== null && provider.provider_id !== "local") {
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "This network is not declared for the external wallet profile; use an explicitly supported local profile.");
  }
}
