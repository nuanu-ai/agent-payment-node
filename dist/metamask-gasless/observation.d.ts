import type { StateStore } from "../state.js";
import type { MetaMaskGaslessClock } from "./clock.js";
import type { MetaMaskGaslessMutable, MetaMaskGaslessProviderObservation } from "./model.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import type { MetaMaskGaslessProviderPort, MetaMaskGaslessRpcFactory, MetaMaskGaslessRpcPort } from "./ports.js";
import { type MetaMaskGaslessFailure, type MetaMaskGaslessFailureReason } from "./reasons.js";
export type MetaMaskGaslessSave = (op: MetaMaskGaslessOperationRecord, patch: Partial<MetaMaskGaslessMutable>, at: string) => Promise<MetaMaskGaslessOperationRecord>;
export interface MetaMaskGaslessStep {
    readonly operation: MetaMaskGaslessOperationRecord;
    /** Explicitly transient; never part of the stored operation or its receipt. */
    readonly warning?: MetaMaskGaslessFailure;
}
/** An owner-named observation RPC with the environment variable that named it. */
export interface MetaMaskGaslessObserver {
    readonly rpc: MetaMaskGaslessRpcPort;
    readonly environmentName: string;
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
    private readonly observer?;
    constructor(state: StateStore, rpcFor: MetaMaskGaslessRpcFactory, provider: MetaMaskGaslessProviderPort, clock: MetaMaskGaslessClock, save: MetaMaskGaslessSave, observer?: MetaMaskGaslessObserver | undefined);
    run(op: MetaMaskGaslessOperationRecord, submitted?: MetaMaskGaslessProviderRead): Promise<MetaMaskGaslessStep>;
    private source;
    private readProvider;
    private retainProvider;
    private decide;
}
