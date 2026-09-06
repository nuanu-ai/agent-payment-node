import { exactKeys, isPlainRecord } from "./canonical.js";
import { BASE_USDC } from "./constants.js";
import { ApnError } from "./errors.js";
import { evmChain, type EvmChainId } from "./evm-asset.js";
import type { Address } from "./model.js";
import type { ProfilePolicyBinding } from "./profile-policy.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalProfile } from "./wallet-policy.js";

export type X402ChainText = `${EvmChainId}`;
export type X402Network = `eip155:${EvmChainId}`;
export interface X402PolicyNetwork { readonly chainId: EvmChainId; readonly token: Address }

export function x402Network(value: unknown = 8453) {
  const chainId = evmChain(value);
  const token = chainId === 8453 ? BASE_USDC : "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
  return { chainId, chainText: `${chainId}` as X402ChainText, network: `eip155:${chainId}` as X402Network, token };
}

export function validX402Tuple(chain: unknown, network: unknown, token: unknown): boolean {
  try {
    const selected = x402Network(network);
    return chain === selected.chainText && typeof token === "string" && token === selected.token.toLowerCase();
  } catch { return false; }
}

export function validPolicyNetwork(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isPlainRecord(value) || !exactKeys(value, ["chainId", "token"])) return false;
  try {
    const selected = x402Network(value.chainId);
    return selected.chainId !== 8453 && value.token === selected.token;
  } catch { return false; }
}

export function networkPolicyBinding(binding: ProfilePolicyBinding, chainId: EvmChainId = 8453): ProfilePolicyBinding {
  const selected = x402Network(chainId);
  return selected.chainId === 8453 ? binding : { ...binding, x402Network: { chainId, token: selected.token } };
}

export function policyStorageIdentity(binding: ProfilePolicyBinding): string {
  canonicalProfile(binding.profile);
  if (!validPolicyNetwork(binding.x402Network)) throw new ApnError("APN_STATE_CORRUPT", "Policy network binding is invalid.");
  return binding.x402Network === undefined ? binding.profile : `~network~${binding.x402Network.chainId}~${binding.x402Network.token.toLowerCase()}~${binding.profile}`;
}

export async function assertLocalNetworkProfile(context: RuntimeContext, profile: string, chainId: EvmChainId = 8453): Promise<void> {
  x402Network(chainId);
  if (chainId === 8453) return;
  const provider = await context.profileRepository?.load(context.state.profileHash(canonicalProfile(profile)));
  if (provider !== undefined && provider !== null && provider.provider_id !== "local") {
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "This network is not declared for the external wallet profile; use an explicitly supported local profile.");
  }
}
