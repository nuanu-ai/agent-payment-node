import { ApnError } from "./errors.js";
import { directEvmNetwork } from "./evm-direct-networks.js";
/** The flows that only ever read Base: legacy Base USDC, provider wallets, provider x402 and Coinbase gasless. */
export const BASE_RPC_CHAIN = Object.freeze({ chainId: 8453, name: "Base" });
/** A direct EVM transfer's own network, as its frozen record or its selection names it. */
export function directRpcChain(chainId) {
    const row = directEvmNetwork(chainId);
    return { chainId: row.chainId, name: row.name };
}
export function rpcUrlRequired(chain) {
    // A CAIP-2 name already carries the chain id.
    const network = chain.name === `eip155:${chain.chainId}` ? chain.name : `${chain.name} (chain ${chain.chainId})`;
    return new ApnError("APN_RPC_CONFIG", `This command reads ${network}: pass --rpc-url with a public HTTPS RPC endpoint of chain ${chain.chainId}.`, {
        reason: "rpc_url_required", chain_id: chain.chainId, network: chain.name,
        nextActions: [`Rerun the same command with --rpc-url set to a public HTTPS RPC endpoint of ${network}.`],
    });
}
//# sourceMappingURL=rpc-requirement.js.map