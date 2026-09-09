import type { Address, Hex } from "../model.js";
import { type GaslessTransport } from "./https.js";
import type { GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessEstimate, GaslessIntent, GaslessObservation, GaslessSnapshot } from "./model.js";
import type { GaslessBootstrapMaterial, GaslessRpcFactory, GaslessRpcPort, GaslessUserOperationMaterial } from "./ports.js";
export declare function gaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>): GaslessRpcFactory;
export declare class GaslessRpc implements GaslessRpcPort {
    readonly chainId: GaslessChainId;
    readonly rpcOrigin: string;
    readonly rpcEndpointHash: string;
    readonly bundlerOrigin: string;
    readonly bundlerEndpointHash: string;
    private readonly rpcEndpoint;
    private readonly bundlerEndpoint;
    private readonly deployment;
    private sequence;
    private readonly rpcCall;
    private readonly bundlerCall;
    constructor(chainId: GaslessChainId, rpcUrl: string, bundlerUrl?: string, transport?: GaslessTransport);
    assertChain(): Promise<void>;
    snapshot(owner: Address): Promise<GaslessSnapshot>;
    estimate(intent: GaslessIntent, bootstrap: GaslessBootstrapMaterial): Promise<GaslessEstimate>;
    send(intent: GaslessIntent, sealed: GaslessUserOperationMaterial): Promise<Hex>;
    observe(intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation>;
    private assertIntent;
    private call;
}
