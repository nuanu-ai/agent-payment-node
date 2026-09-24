export type TronMethod = "wallet/getblockbynum" | "wallet/getnowblock" | "wallet/getnodeinfo" | "wallet/getchainparameters" | "wallet/getnextmaintenancetime" | "wallet/getaccount" | "wallet/getaccountresource" | "wallet/triggerconstantcontract" | "wallet/estimateenergy" | "wallet/broadcasttransaction" | "wallet/getcontractinfo" | "wallet/gettransactionbyid" | "wallet/gettransactioninfobyid" | "walletsolidity/gettransactionbyid" | "walletsolidity/gettransactioninfobyid" | "walletsolidity/getblockbynum" | "walletsolidity/getnowblock" | "walletsolidity/getaccount" | "walletsolidity/triggerconstantcontract";
export declare const TRON_RPC_METHODS: readonly TronMethod[];
export interface TronRpcPort {
    readonly originHash: string;
    call(method: TronMethod, body: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export declare class TronRpc implements TronRpcPort {
    private readonly endpoint?;
    private readonly fetcher;
    readonly originHash: string;
    constructor(endpoint?: string | undefined, fetcher?: typeof fetch);
    call(method: TronMethod, body: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export interface TronBlock {
    readonly id: string;
    readonly number: bigint;
    readonly timestamp: bigint;
    readonly body: Record<string, unknown>;
}
export declare function tronBlock(value: unknown): TronBlock;
export declare function assertTronNetwork(rpc: TronRpcPort): Promise<string>;
