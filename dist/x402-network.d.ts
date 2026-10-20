import type { Address } from "./model.js";
import type { ProfilePolicyBinding } from "./profile-policy.js";
import type { RuntimeContext } from "./runtime.js";
export type X402ChainText = `${number}`;
export type X402Network = `eip155:${number}`;
export interface X402PolicyNetwork {
    readonly chainId: number;
    readonly token: Address;
}
/** The profile x402 policy of Solana x402 for one SPL mint (`wallet policy set --chain solana:5eykt4… --asset <mint>`). */
export interface X402SolanaPolicyNetwork {
    readonly mint: string;
}
/** x402's CAIP-2 name of Solana mainnet (equal to X402_SOLANA_NETWORK of the Solana x402 family; kept here without its imports). */
export declare const X402_SOLANA_POLICY_NETWORK: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export declare function solanaAccount(value: unknown): boolean;
export declare function validSolanaPolicyNetwork(value: unknown): value is X402SolanaPolicyNetwork;
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
/** An EVM chain by number or exact `eip155:<id>`; the RPC's eth_chainId must later equal it. */
export declare function x402Chain(value: unknown): number;
export declare function x402ProofTag(chainId: number): X402ProofTag;
/** The selected network and token; without a token only the released USDC spelling of Base, Ethereum or Arbitrum. */
export declare function x402Asset(chain?: unknown, token?: unknown): X402Asset;
/** The legacy accessor of the released USDC spelling (`x402Asset` without a token). */
export declare function x402Network(value?: unknown): X402Asset;
/** The asset a stored record names, from its own network and token fields. */
export declare function x402AssetOf(record: {
    readonly network: string;
    readonly token: string;
}): X402Asset;
/** True for the three (network, USDC) pairs APN released x402 on; their records, hashes and policies keep the old shape. */
export declare function releasedX402Pair(chainId: number | string, token: string): boolean;
export declare function isBaseUsdc(asset: {
    readonly chainId: number;
    readonly token: string;
}): boolean;
/** A stored (chainId, network, token) triple is consistent with itself: canonical chain text, CAIP-2 and lowercase token. */
export declare function validX402Tuple(chain: unknown, network: unknown, token: unknown): boolean;
export declare function validPolicyNetwork(value: unknown): boolean;
/** Base USDC keeps the original no-network policy record; every other chain or token has its own. */
export declare function networkPolicyBinding(binding: ProfilePolicyBinding, selection?: X402Asset | number): ProfilePolicyBinding;
export declare function policyStorageIdentity(binding: ProfilePolicyBinding): string;
/** External wallet profiles pay only Base USDC; every other network or token needs a local profile. */
export declare function assertLocalNetworkProfile(context: RuntimeContext, profile: string, selection?: X402Asset | number): Promise<void>;
