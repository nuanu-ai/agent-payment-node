import { exactKeys, isPlainRecord } from "./canonical.js";
import { BASE_USDC } from "./constants.js";
import { ApnError } from "./errors.js";
import { evmChain } from "./evm-asset.js";
import { canonicalProfile } from "./wallet-policy.js";
export function x402Network(value = 8453) {
    const chainId = evmChain(value);
    const tokens = {
        8453: BASE_USDC,
        1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    };
    return { chainId, chainText: `${chainId}`, network: `eip155:${chainId}`, token: tokens[chainId] };
}
export function validX402Tuple(chain, network, token) {
    try {
        const selected = x402Network(network);
        return chain === selected.chainText && typeof token === "string" && token === selected.token.toLowerCase();
    }
    catch {
        return false;
    }
}
export function validPolicyNetwork(value) {
    if (value === undefined)
        return true;
    if (!isPlainRecord(value) || !exactKeys(value, ["chainId", "token"]))
        return false;
    try {
        const selected = x402Network(value.chainId);
        return selected.chainId !== 8453 && value.token === selected.token;
    }
    catch {
        return false;
    }
}
export function networkPolicyBinding(binding, chainId = 8453) {
    const selected = x402Network(chainId);
    return selected.chainId === 8453 ? binding : { ...binding, x402Network: { chainId, token: selected.token } };
}
export function policyStorageIdentity(binding) {
    canonicalProfile(binding.profile);
    if (!validPolicyNetwork(binding.x402Network))
        throw new ApnError("APN_STATE_CORRUPT", "Policy network binding is invalid.");
    return binding.x402Network === undefined ? binding.profile : `~network~${binding.x402Network.chainId}~${binding.x402Network.token.toLowerCase()}~${binding.profile}`;
}
export async function assertLocalNetworkProfile(context, profile, chainId = 8453) {
    x402Network(chainId);
    if (chainId === 8453)
        return;
    const provider = await context.profileRepository?.load(context.state.profileHash(canonicalProfile(profile)));
    if (provider !== undefined && provider !== null && provider.provider_id !== "local") {
        throw new ApnError("APN_PROVIDER_UNAVAILABLE", "This network is not declared for the external wallet profile; use an explicitly supported local profile.");
    }
}
//# sourceMappingURL=x402-network.js.map