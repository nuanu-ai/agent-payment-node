import { ApnError } from "./errors.js";
import { directEvmNetwork, type DirectEvmChainId } from "./evm-direct-networks.js";

/**
 * The one chain a command's `--rpc-url` must serve. A missing endpoint is refused naming exactly this chain and the
 * setting that supplies it, never another network: an Ethereum transfer approved without `--rpc-url` once asked for a
 * Base RPC (DIRECT-RPC-CONFIG-NETWORK-GUIDANCE-052-001). The endpoint's chain id is still proven where it is used.
 */
export interface RpcChain { readonly chainId: number; readonly name: string }

/** The flows that only ever read Base: legacy Base USDC, provider wallets, provider x402 and Coinbase gasless. */
export const BASE_RPC_CHAIN: RpcChain = Object.freeze({ chainId: 8453, name: "Base" });

/** A direct EVM transfer's own network, as its frozen record or its selection names it. */
export function directRpcChain(chainId: DirectEvmChainId): RpcChain {
  const row = directEvmNetwork(chainId);
  return { chainId: row.chainId, name: row.name };
}

export function rpcUrlRequired(chain: RpcChain): ApnError {
  // A CAIP-2 name already carries the chain id.
  const network = chain.name === `eip155:${chain.chainId}` ? chain.name : `${chain.name} (chain ${chain.chainId})`;
  return new ApnError("APN_RPC_CONFIG", `This command reads ${network}: pass --rpc-url with a public HTTPS RPC endpoint of chain ${chain.chainId}.`, {
    reason: "rpc_url_required", chain_id: chain.chainId, network: chain.name,
    nextActions: [`Rerun the same command with --rpc-url set to a public HTTPS RPC endpoint of ${network}.`],
  });
}
