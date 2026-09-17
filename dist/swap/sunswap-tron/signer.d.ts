import type { ChainAccount, ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { SwapChainSignerPort, SwapChainSenderPort } from "../ports.js";
import { type SwapOperationRecord } from "../model.js";
import { SwapOperationRepository } from "../repository.js";
import type { SunSwapSimulationProof } from "./simulation.js";
import { type SunSwapUnsignedIntent, type SunSwapUnsignedTransaction } from "./transaction.js";
export interface SunSwapExecutionBinding {
    readonly account: ChainAccount;
    readonly intent: SunSwapUnsignedIntent;
    readonly transaction: SunSwapUnsignedTransaction;
    readonly simulation: SunSwapSimulationProof;
}
export interface SunSwapBroadcastRpcPort {
    call(method: "wallet/broadcasttransaction", body: Readonly<Record<string, unknown>>): Promise<unknown>;
}
/**
 * A per-operation protected adapter. Signed bytes remain in ChainAccountStore's authenticated
 * encrypted envelope; the public swap journal receives only the opaque binding fingerprint.
 */
export declare class SunSwapProtectedExecutionAdapter implements SwapChainSignerPort, SwapChainSenderPort {
    private readonly storage;
    private readonly rpc;
    private readonly operations;
    private readonly binding;
    private readonly operation;
    private readonly fingerprint;
    constructor(storage: ChainWalletStoragePort, rpc: SunSwapBroadcastRpcPort, operations: SwapOperationRepository, operation: SwapOperationRecord, binding: SunSwapExecutionBinding);
    sign(operationValue: SwapOperationRecord): Promise<{
        readonly signedMaterialHandle: string;
    }>;
    recover(): Promise<{
        readonly signedMaterialHandle: string;
    } | null>;
    sendOnce(signedMaterialHandle: string, submissionMarkerHash: string): Promise<{
        readonly transactionHash: string;
    }>;
    private effect;
}
export declare function validateSunSwapExecutionBinding(operationValue: unknown, bindingValue: unknown): string;
export interface SunSwapSignedTransaction extends SunSwapUnsignedTransaction {
    readonly signature: readonly [string];
}
export declare function signSunSwapTransaction(transactionValue: unknown, owner: string, seed: Buffer): SunSwapSignedTransaction;
export declare function validateSunSwapSignedTransaction(value: unknown, unsigned: SunSwapUnsignedTransaction, owner: string): SunSwapSignedTransaction;
