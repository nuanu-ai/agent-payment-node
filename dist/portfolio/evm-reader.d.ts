import type { BatchBalanceRequest, BatchBalanceResult, FamilyBalanceBatchPort } from "../asset-portfolio-reader.js";
import type { PortfolioHttpPort } from "./https.js";
import { type PortfolioNetworkRpc } from "./registry.js";
/**
 * One HTTP request per EVM network. With a pinned Multicall3 it carries `eth_getCode` (runtime-code hash check)
 * and one `aggregate3` `eth_call` that also returns chainId and block number; otherwise one plain JSON-RPC batch array.
 */
export declare class EvmPortfolioPort implements FamilyBalanceBatchPort {
    private readonly http;
    private readonly registry;
    readonly family: "evm";
    constructor(http: PortfolioHttpPort, registry?: readonly PortfolioNetworkRpc[]);
    read(request: BatchBalanceRequest): Promise<BatchBalanceResult>;
}
