import type { Address } from "./model.js";
import { type DirectEvmChainId } from "./evm-direct-networks.js";
export declare const EVM_NETWORKS: readonly [{
    readonly chainId: 8453;
    readonly name: "Base";
    readonly caip2: "eip155:8453";
}, {
    readonly chainId: 1;
    readonly name: "Ethereum";
    readonly caip2: "eip155:1";
}, {
    readonly chainId: 42161;
    readonly name: "Arbitrum One";
    readonly caip2: "eip155:42161";
}];
export type EvmChainId = typeof EVM_NETWORKS[number]["chainId"];
export declare const NATIVE_ASSET_ADDRESS: "0x0000000000000000000000000000000000000000";
export declare const MAX_EVM_UINT: bigint;
export declare const MAX_DIRECT_TRANSACTION_BYTES = 512;
/** A direct-transfer asset may live on any direct network, a superset of the shared `EvmChainId` networks. */
export interface EvmAssetSelection {
    readonly chainId: DirectEvmChainId;
    readonly token: "native" | Address;
    readonly decimals?: number;
}
export interface EvmAsset {
    readonly schemaVersion: "apn.evm-asset.v1";
    readonly chainId: DirectEvmChainId;
    readonly kind: "native" | "erc20";
    readonly address: Address;
    readonly decimals: number;
    readonly decimalsSource: "native" | "onchain" | "caller";
}
export declare function evmChain(value: unknown): EvmChainId;
export declare function evmToken(value: unknown): "native" | Address;
export declare function evmDecimals(value: unknown): number;
export declare function evmUint(value: unknown, positive?: boolean): bigint;
export declare function evmAmount(value: unknown, decimals: number): {
    readonly atomic: string;
    readonly decimal: string;
};
export declare function resolveEvmAsset(selection: EvmAssetSelection, observedDecimals?: number): EvmAsset;
export declare function validateEvmAsset(value: unknown): EvmAsset;
export declare function publicEvmAsset(asset: EvmAsset): unknown;
export declare function validateEvmAmount(asset: EvmAsset, atomic: string, decimal: string): void;
