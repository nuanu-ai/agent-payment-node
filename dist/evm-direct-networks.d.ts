import { type CandidateAsset } from "./allowlist-inventory.js";
/**
 * How a network charges a direct transfer, beyond `gas limit x max fee per gas`:
 * - `eip1559`: execution only; the charge is gas used x effective price, so the budget is an upper bound.
 * - `op-stack`: execution plus the L1 data fee and operator fee read from the GasPriceOracle predeploy.
 * - `arbitrum-inclusive`: the L1 posting cost is folded into L2 gas; no separate surcharge and no priority fee.
 * - `monad-gas-limit`: Monad bills the full gas limit, not gas used, so the charge is the budgeted limit x effective price.
 */
export type DirectEvmFeeModel = "eip1559" | "op-stack" | "arbitrum-inclusive" | "monad-gas-limit";
/**
 * When a successful receipt completes a transfer:
 * - `inclusion`: a canonical receipt at the selected RPC's latest head.
 * - `safe`: the receipt block must also be at or below the selected RPC's `safe` head.
 */
export type DirectEvmFinality = "inclusion" | "safe";
export interface DirectEvmNetwork {
    readonly chainId: number;
    readonly caip2: string;
    readonly name: string;
    readonly nativeSymbol: string;
    readonly nativeDecimals: 18;
    readonly feeModel: DirectEvmFeeModel;
    readonly finality: DirectEvmFinality;
}
/**
 * The networks on which a local wallet may prepare a direct native or list-token transfer. It is deliberately separate
 * from `EVM_NETWORKS`, which x402, LI.FI, wallet policy and portfolio share: widening that list would enable those
 * rails too. Fee and finality behaviour was checked read-only against each mainnet on 2026-09-18 (docs/evm-assets.md).
 */
export declare const DIRECT_EVM_NETWORKS: readonly [{
    chainId: 1;
    caip2: "eip155:1";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 8453;
    caip2: "eip155:8453";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 42161;
    caip2: "eip155:42161";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 10;
    caip2: "eip155:10";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 137;
    caip2: "eip155:137";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 56;
    caip2: "eip155:56";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 43114;
    caip2: "eip155:43114";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 130;
    caip2: "eip155:130";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 59144;
    caip2: "eip155:59144";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 143;
    caip2: "eip155:143";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}, {
    chainId: 1329;
    caip2: "eip155:1329";
    name: string;
    nativeSymbol: string;
    nativeDecimals: 18;
    feeModel: DirectEvmFeeModel;
    finality: DirectEvmFinality;
}];
export type DirectEvmNetworkRow = typeof DIRECT_EVM_NETWORKS[number];
export type DirectEvmChainId = DirectEvmNetworkRow["chainId"];
/** Fee models whose meaning a persisted quote must name; the rest keep the quote shape frozen before this registry. */
export type DirectEvmQuoteFeeModel = "arbitrum-inclusive" | "monad-gas-limit";
export declare function directEvmChain(value: unknown): DirectEvmChainId;
export declare function directEvmNetwork(chainId: DirectEvmChainId): DirectEvmNetworkRow;
export declare function directEvmNetworkByCaip2(chain: string): DirectEvmNetworkRow | undefined;
export declare function directEvmQuoteFeeModel(chainId: DirectEvmChainId): DirectEvmQuoteFeeModel | undefined;
export declare function directEvmRequiresSafeHead(chainId: DirectEvmChainId): boolean;
/**
 * Direct rows of one network: frozen native/token identities plus the three C1-12 direct-only token deployments.
 * The registry's native coin must agree with the frozen row, so a list revision cannot silently rename or re-scale it.
 */
export declare function directEvmListRows(chainId: DirectEvmChainId): readonly CandidateAsset[];
