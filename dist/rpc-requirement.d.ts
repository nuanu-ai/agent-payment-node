import { ApnError } from "./errors.js";
import { type DirectEvmChainId } from "./evm-direct-networks.js";
/**
 * The one chain a command's `--rpc-url` must serve. A missing endpoint is refused naming exactly this chain and the
 * setting that supplies it, never another network: an Ethereum transfer approved without `--rpc-url` once asked for a
 * Base RPC (DIRECT-RPC-CONFIG-NETWORK-GUIDANCE-052-001). The endpoint's chain id is still proven where it is used.
 */
export interface RpcChain {
    readonly chainId: number;
    readonly name: string;
}
/** The flows that only ever read Base: legacy Base USDC, provider wallets, provider x402 and Coinbase gasless. */
export declare const BASE_RPC_CHAIN: RpcChain;
/** A direct EVM transfer's own network, as its frozen record or its selection names it. */
export declare function directRpcChain(chainId: DirectEvmChainId): RpcChain;
export declare function rpcUrlRequired(chain: RpcChain): ApnError;
