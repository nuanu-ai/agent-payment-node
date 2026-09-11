import type { RailPreparedTransfer, RailSignedEffect } from "../direct-rail-ports.js";
interface TronTransactionIntent {
    readonly token: boolean;
    readonly sender: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly blockId: string;
    readonly timestamp: string;
    readonly expiration: string;
    readonly energyFeeLimitAtomic: string;
}
export interface TronTransaction {
    readonly visible: false;
    readonly txID: string;
    readonly raw_data_hex: string;
    readonly raw_data: {
        readonly contract: readonly {
            readonly type: "TransferContract" | "TriggerSmartContract";
            readonly parameter: {
                readonly type_url: string;
                readonly value: Readonly<Record<string, unknown>>;
            };
        }[];
        readonly ref_block_bytes: string;
        readonly ref_block_hash: string;
        readonly timestamp: number;
        readonly expiration: number;
        readonly fee_limit?: number;
    };
    readonly signature?: readonly string[];
}
export declare function buildTronTransaction(input: TronTransactionIntent): TronTransaction;
export declare function unsignedTronPrepared(prepared: RailPreparedTransfer): TronTransaction;
export declare function validateTronChainTransaction(value: unknown, prepared: RailPreparedTransfer): TronTransaction;
export declare function validateTronEffect(prepared: RailPreparedTransfer, effect: RailSignedEffect): TronTransaction;
export declare function signTronTransaction(prepared: RailPreparedTransfer, seed: Buffer): TronTransaction;
export {};
