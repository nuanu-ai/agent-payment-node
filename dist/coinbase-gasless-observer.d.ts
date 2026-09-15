import type { Address, CoinbaseGaslessBlock, CoinbaseGaslessCursor, CoinbaseGaslessSettlement, Hex, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
export declare const COINBASE_ENTRY_POINT: Address;
export declare const COINBASE_ACCOUNT_IMPLEMENTATION: Address;
export declare const COINBASE_ACCOUNT_CODE_HASH: Hex;
export declare const COINBASE_ACCOUNT_IMPLEMENTATION_CODE_HASH: Hex;
export declare const COINBASE_ENTRY_POINT_CODE_HASH: Hex;
export interface CoinbaseGaslessSnapshot {
    readonly rpcOrigin: string;
    readonly safeBlock: CoinbaseGaslessBlock;
    readonly balanceAtomic: string;
    readonly entryPointCodeHash: Hex;
    readonly accountCodeHash: Hex;
    readonly accountImplementation: Address;
    readonly accountImplementationCodeHash: Hex;
}
export type CoinbaseGaslessObservation = {
    readonly status: "not_found" | "pending" | "unresolved" | "ambiguous";
    readonly cursor: CoinbaseGaslessCursor;
    readonly reason: string;
} | {
    readonly status: "safe";
    readonly cursor: CoinbaseGaslessCursor;
    readonly settlement: CoinbaseGaslessSettlement;
};
export declare function coinbaseGaslessSnapshot(rpc: RpcPort, sender: Address): Promise<CoinbaseGaslessSnapshot>;
export declare function observeCoinbaseGasless(rpc: RpcPort, operation: OperationRecord): Promise<CoinbaseGaslessObservation>;
