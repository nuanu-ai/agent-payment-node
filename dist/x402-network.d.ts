import { type EvmChainId } from "./evm-asset.js";
import type { Address } from "./model.js";
import type { ProfilePolicyBinding } from "./profile-policy.js";
import type { RuntimeContext } from "./runtime.js";
export type X402ChainText = `${EvmChainId}`;
export type X402Network = `eip155:${EvmChainId}`;
export interface X402PolicyNetwork {
    readonly chainId: EvmChainId;
    readonly token: Address;
}
export declare function x402Network(value?: unknown): {
    chainId: 1 | 8453 | 42161;
    chainText: X402ChainText;
    network: X402Network;
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" | "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" | "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
};
export declare function validX402Tuple(chain: unknown, network: unknown, token: unknown): boolean;
export declare function validPolicyNetwork(value: unknown): boolean;
export declare function networkPolicyBinding(binding: ProfilePolicyBinding, chainId?: EvmChainId): ProfilePolicyBinding;
export declare function policyStorageIdentity(binding: ProfilePolicyBinding): string;
export declare function assertLocalNetworkProfile(context: RuntimeContext, profile: string, chainId?: EvmChainId): Promise<void>;
