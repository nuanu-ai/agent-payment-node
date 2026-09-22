import type { BatchBalanceRequest, BatchBalanceResult, FamilyBalanceBatchPort } from "../asset-portfolio-reader.js";
import type { PortfolioHttpPort } from "./https.js";
import { type PortfolioNetworkRpc } from "./registry.js";
export declare const MULTICALL3_ABI: readonly [{
    readonly type: "function";
    readonly name: "aggregate3";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "calls";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "target";
            readonly type: "address";
        }, {
            readonly name: "allowFailure";
            readonly type: "bool";
        }, {
            readonly name: "callData";
            readonly type: "bytes";
        }];
    }];
    readonly outputs: readonly [{
        readonly name: "returnData";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "success";
            readonly type: "bool";
        }, {
            readonly name: "returnData";
            readonly type: "bytes";
        }];
    }];
}, {
    readonly type: "function";
    readonly name: "getChainId";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "chainid";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "getBlockNumber";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "blockNumber";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "getEthBalance";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "addr";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "balance";
        readonly type: "uint256";
    }];
}];
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
