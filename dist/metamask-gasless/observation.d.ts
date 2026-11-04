import type { StateStore } from "../state.js";
import type { MetaMaskSubmitDiagnostic } from "./client/submit-diagnostic.js";
import { type MetaMaskObserveDiagnostic } from "./client/observe-diagnostic.js";
import type { MetaMaskGaslessClock } from "./clock.js";
import type { MetaMaskGaslessCursor, MetaMaskGaslessMutable, MetaMaskGaslessObservation, MetaMaskGaslessProviderObservation } from "./model.js";
import { type MetaMaskGaslessOperationRecord } from "./operation-model.js";
import type { MetaMaskGaslessProviderPort, MetaMaskGaslessRpcFactory, MetaMaskGaslessRpcPort } from "./ports.js";
import { type MetaMaskGaslessFailure, type MetaMaskGaslessFailureReason } from "./reasons.js";
export type MetaMaskGaslessSave = (op: MetaMaskGaslessOperationRecord, patch: Partial<MetaMaskGaslessMutable>, at: string) => Promise<MetaMaskGaslessOperationRecord>;
export interface MetaMaskGaslessStep {
    readonly operation: MetaMaskGaslessOperationRecord;
    /** Explicitly transient; never part of the stored operation or its receipt. */
    readonly warning?: MetaMaskGaslessFailure;
    /** A nonterminal result read after only the reserved terminal slot was left; reported, never saved. */
    readonly unsaved?: {
        readonly observation: MetaMaskGaslessObservation;
        readonly cursor: MetaMaskGaslessCursor;
    };
    /** Where this call's own submit stopped, when it ended unknown (client/submit-diagnostic.ts); reported, never saved. */
    readonly submitDiagnostic?: MetaMaskSubmitDiagnostic;
    /** What this call's own read of the provider job said, when it made one; reported, never saved. */
    readonly providerRead?: MetaMaskGaslessProviderReadReport;
}
/** The job status the read accepted, or why it was refused (client/observe-diagnostic.ts when an answer check refused it). */
export type MetaMaskGaslessProviderReadReport = {
    readonly ok: true;
    readonly status: MetaMaskGaslessProviderObservation["status"];
    readonly txHash: boolean;
} | {
    readonly ok: false;
    readonly reason: MetaMaskGaslessFailureReason;
    readonly diagnostic: MetaMaskObserveDiagnostic | null;
};
/** An owner-named observation RPC with the environment variable that named it. */
export interface MetaMaskGaslessObserver {
    readonly rpc: MetaMaskGaslessRpcPort;
    readonly environmentName: string;
}
/** The accepted job status, or the reason it was refused; never both, never neither. */
export type MetaMaskGaslessProviderRead = {
    readonly hint: MetaMaskGaslessProviderObservation;
    readonly failure: null;
} | {
    readonly hint: null;
    readonly failure: MetaMaskGaslessFailureReason;
    readonly diagnostic?: MetaMaskSubmitDiagnostic;
    /** Which answer check refused this observation's own job read, if one did. */
    readonly observeDiagnostic?: MetaMaskObserveDiagnostic;
};
export declare function metaMaskGaslessProviderObservation(value: unknown, op: MetaMaskGaslessOperationRecord): MetaMaskGaslessProviderObservation;
export declare class MetaMaskGaslessObservationService {
    private readonly state;
    private readonly rpcFor;
    private readonly provider;
    private readonly clock;
    private readonly save;
    private readonly observer?;
    constructor(state: StateStore, rpcFor: MetaMaskGaslessRpcFactory, provider: MetaMaskGaslessProviderPort, clock: MetaMaskGaslessClock, save: MetaMaskGaslessSave, observer?: MetaMaskGaslessObserver | undefined);
    /**
     * One bounded observation. An operation the owner abandoned is observed the same way (provider status bound to the
     * original request, then the chain), but only a proof replaces the abandonment: the redemption, or its delegation
     * disabled before any redemption. Anything else is reported, never saved.
     */
    run(op: MetaMaskGaslessOperationRecord, submitted?: MetaMaskGaslessProviderRead): Promise<MetaMaskGaslessStep>;
    private once;
    private source;
    private readProvider;
    private retainProvider;
    private decide;
}
