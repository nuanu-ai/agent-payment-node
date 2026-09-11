import { type GaslessTransport } from "./https.js";
import type { GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessIntent, GaslessObservation } from "./model.js";
import type { GaslessObservationPort, GaslessObservationRpcFactory } from "./ports.js";
export declare function gaslessObservationRpcFactory(environment: Readonly<Record<string, string | undefined>>): GaslessObservationRpcFactory;
/** One explicit observation source. No bundler, key, estimate or send capability exists here. */
export declare class GaslessObservationRpc implements GaslessObservationPort {
    private readonly transport;
    readonly chainId: GaslessChainId;
    readonly rpcOrigin: string;
    readonly rpcEndpointHash: string;
    private readonly endpoint;
    private readonly environmentName;
    private readonly deployment;
    private sequence;
    private readonly rpcCall;
    constructor(chainId: GaslessChainId, rpcUrl: string, environmentName: string, transport?: GaslessTransport);
    observe(intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation>;
    private call;
}
