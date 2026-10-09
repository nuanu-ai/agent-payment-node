import { type Hex } from "viem";
import { BridgeHttps } from "../lifi/https.js";
import type { StateStore } from "../state.js";
import type { MerchantEnvelope, MerchantOperation, MerchantReceipt } from "./model.js";
export interface MerchantRpcPort {
    call(method: string, params: readonly unknown[], beforeSend?: () => Promise<void> | void, beforeWire?: () => void): Promise<unknown>;
    batch(calls: readonly {
        method: string;
        params: readonly unknown[];
    }[]): Promise<readonly unknown[]>;
}
export declare class MerchantRpc implements MerchantRpcPort {
    private readonly transport;
    private sequence;
    private readonly guard;
    constructor(state: StateStore, transport?: BridgeHttps);
    batch(calls: readonly {
        method: string;
        params: readonly unknown[];
    }[]): Promise<readonly unknown[]>;
    call(method: string, params: readonly unknown[], beforeSend?: () => Promise<void> | void, beforeWire?: () => void): Promise<unknown>;
}
export declare const MERCHANT_DATA: `0x${string}`;
export declare function quantity(v: unknown): bigint;
export declare function object(v: unknown): Record<string, unknown>;
export declare function bytes(v: unknown): Hex;
export declare function hexHash(v: unknown): Hex;
export declare function rpcTransaction(): {
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
};
/** Fresh runtime, proxy implementation, real domain, balances and pending nonce at one rechecked anchor. */
export declare function merchantCurrent(rpc: MerchantRpcPort): Promise<{
    nonce: string;
    gas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    native: string;
    token: string;
}>;
export declare function checkMerchantEnvelope(current: Awaited<ReturnType<typeof merchantCurrent>>, envelope: MerchantEnvelope): void;
export declare function merchantHeader(value: unknown): Record<string, unknown>;
/** Independent canonical finalized receipt + full transaction + exact token Transfer. No HTTP settlement inference. */
export declare function merchantReceipt(rpc: MerchantRpcPort, o: MerchantOperation): Promise<MerchantReceipt | null>;
