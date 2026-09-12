import { type GaslessTransport } from "./https.js";
import type { GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessIntent, GaslessObservation } from "./model.js";
import type { GaslessObservationPort, GaslessObservationRpcFactory } from "./ports.js";
export interface GaslessObservationPacing {
    readonly minimumIntervalMs: number;
    monotonicNow(): number;
    sleep(milliseconds: number): Promise<void>;
}
export declare function gaslessObservationRpcFactory(environment: Readonly<Record<string, string | undefined>>): GaslessObservationRpcFactory;
/** One explicit observation source. No bundler, key, estimate or send capability exists here. */
export declare class GaslessObservationRpc implements GaslessObservationPort {
    private readonly transport;
    private readonly pacing;
    readonly chainId: GaslessChainId;
    readonly rpcOrigin: string;
    readonly rpcEndpointHash: string;
    private readonly endpoint;
    private readonly environmentName;
    private readonly deployment;
    private sequence;
    private readonly rpcCall;
    private queue;
    private lastRequestAt;
    private unavailable;
    constructor(chainId: GaslessChainId, rpcUrl: string, environmentName: string, transport?: GaslessTransport, pacing?: GaslessObservationPacing);
    observe(intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation>;
    private call;
    private request;
}
