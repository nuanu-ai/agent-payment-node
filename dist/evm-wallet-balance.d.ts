import { type EvmAssetSelection } from "./evm-asset.js";
import type { RuntimeContext } from "./runtime.js";
/**
 * One balance path for every EVM chain. The wallet and policy are read under the profile lock; the RPC read is not. A token
 * is assessed against the policy of its exact chain and token, the one x402 payment enforces (QA 0.5.54: a Sei USDC policy
 * read as absent while payment refused as overfunded). Native gas has no token of its own: only a legacy network's released
 * USDC policy carries it implicitly; elsewhere its cap lives in each token's policy and is read with that token.
 */
export declare function evmWalletBalance(context: RuntimeContext, profileInput: string, selection: EvmAssetSelection): Promise<unknown>;
