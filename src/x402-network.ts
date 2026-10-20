import { getAddress } from "viem";
import { exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC } from "./constants.js";
import { ApnError } from "./errors.js";
import type { Address } from "./model.js";
import type { ProfilePolicyBinding } from "./profile-policy.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalProfile } from "./wallet-policy.js";
import { address as solanaAddress } from "@solana/kit";

export type X402ChainText = `${number}`;
export type X402Network = `eip155:${number}`;
export interface X402PolicyNetwork { readonly chainId: number; readonly token: Address }
/** The profile x402 policy of Solana x402 for one SPL mint (`wallet policy set --chain solana:5eykt4… --asset <mint>`). */
export interface X402SolanaPolicyNetwork { readonly mint: string }
/** x402's CAIP-2 name of Solana mainnet (equal to X402_SOLANA_NETWORK of the Solana x402 family; kept here without its imports). */
export const X402_SOLANA_POLICY_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;
export function solanaAccount(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return solanaAddress(value) === value; } catch { return false; }
}
export function validSolanaPolicyNetwork(value: unknown): value is X402SolanaPolicyNetwork {
  return isPlainRecord(value) && exactKeys(value, ["mint"]) && solanaAccount(value.mint);
}
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
/**
 * Chains whose x402 settlement is proven at `safe`, decided by the chain's stack, never by what a node answers:
 * - Ethereum (1, justified checkpoint) and Arbitrum One (42161, Nitro: batch posted to L1), as released APN does;
 * - OP Stack chains (`safe` = derived from data posted to L1), the rule APN already uses for Base. Source: the OP
 *   Superchain Registry (github.com/ethereum-optimism/superchain-registry) for the stack, corroborated on chain on
 *   2026-10-20: the L1Block (0x4200…0015) and GasPriceOracle (0x4200…000F) predeploys present and `safe` served behind
 *   `latest` (docs/x402-any-seller.md). OP 10, Base 8453, World Chain 480, Celo 42220, Unichain 130, Ink 57073,
 *   Soneium 1868, Mode 34443, Zora 7777777, Lisk 1135, Fraxtal 252, Metal L2 1750, Shape 360.
 * Every other chain proves at `finalized`, the stronger tag (Polygon PoS clients serve no `safe`).
 */
const SAFE_PROOF_CHAINS: readonly number[] = Object.freeze([1, 42161, 10, 8453, 480, 42220, 130, 57073, 1868, 34443, 7777777, 1135, 252, 1750, 360]);
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
  if (binding.x402Solana !== undefined) {
    // Base58 mints differ by case alone, so the file name carries their hash (state files may sit on a case-folding volume).
    if (binding.x402Network !== undefined || !validSolanaPolicyNetwork(binding.x402Solana)) throw new ApnError("APN_STATE_CORRUPT", "Policy network binding is invalid.");
    return `~solana~${sha256(`${X402_SOLANA_POLICY_NETWORK}\0${binding.x402Solana.mint}`)}~${binding.profile}`;
  }
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
