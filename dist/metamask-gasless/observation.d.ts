import type { StateStore } from "../state.js";
import type { MetaMaskGaslessClock } from "./clock.js";
import type { MetaMaskGaslessMutable, MetaMaskGaslessProviderObservation } from "./model.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import type { MetaMaskGaslessProviderPort, MetaMaskGaslessRpcFactory } from "./ports.js";
import { type MetaMaskGaslessFailure, type MetaMaskGaslessFailureReason } from "./reasons.js";
export type MetaMaskGaslessSave = (op: MetaMaskGaslessOperationRecord, patch: Partial<MetaMaskGaslessMutable>, at: string) => Promise<MetaMaskGaslessOperationRecord>;
export interface MetaMaskGaslessStep {
    readonly operation: MetaMaskGaslessOperationRecord;
    /** Explicitly transient; never part of the stored operation or its receipt. */
    readonly warning?: MetaMaskGaslessFailure;
}
export interface MetaMaskGaslessProviderRead {
    readonly hint: MetaMaskGaslessProviderObservation | null;
    readonly failure: MetaMaskGaslessFailureReason | null;
}
export declare function metaMaskGaslessProviderObservation(value: unknown, op: MetaMaskGaslessOperationRecord): MetaMaskGaslessProviderObservation;
export declare class MetaMaskGaslessObservationService {
    private readonly state;
    private readonly rpcFor;
    private readonly provider;
    private readonly clock;
    private readonly save;
    constructor(state: StateStore, rpcFor: MetaMaskGaslessRpcFactory, provider: MetaMaskGaslessProviderPort, clock: MetaMaskGaslessClock, save: MetaMaskGaslessSave);
    run(op: MetaMaskGaslessOperationRecord, submitted?: MetaMaskGaslessProviderRead): Promise<MetaMaskGaslessStep>;
    private readProvider;
    private retainProvider;
    private decide;
}
