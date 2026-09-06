import type { Address } from "./model.js";
export type EvmChainId = 8453;
export declare const EVM_NETWORKS: readonly [{
    readonly chainId: 8453;
    readonly name: "Base";
    readonly caip2: "eip155:8453";
}];
export declare const NATIVE_ASSET_ADDRESS: "0x0000000000000000000000000000000000000000";
export declare const MAX_EVM_UINT: bigint;
export declare const MAX_DIRECT_TRANSACTION_BYTES = 512;
export interface EvmAssetSelection {
    readonly chainId: EvmChainId;
    readonly token: "native" | Address;
    readonly decimals?: number;
}
export interface EvmAsset {
    readonly schemaVersion: "apn.evm-asset.v1";
    readonly chainId: EvmChainId;
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
