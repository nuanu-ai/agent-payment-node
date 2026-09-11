import type { TronRpcPort } from "./rpc.js";
export interface TronAccountRead {
    readonly exists: boolean;
    readonly normal: boolean;
    readonly balance: bigint;
    readonly raw: Record<string, unknown>;
}
export declare function readTronAccount(rpc: TronRpcPort, address: string, solidified?: boolean): Promise<TronAccountRead>;
export declare function requireTronOwner(account: TronAccountRead, sender: string): void;
export declare function requireTronUsdt(rpc: TronRpcPort): Promise<void>;
export declare function tronUsdtBalance(rpc: TronRpcPort, address: string, solidified?: boolean): Promise<bigint>;
export declare function tronEnergyEstimate(rpc: TronRpcPort, sender: string, recipient: string, amount: string): Promise<bigint>;
