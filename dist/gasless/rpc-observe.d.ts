import type { Address } from "../model.js";
import type { GaslessChainId, GaslessCursor, GaslessDeployment, GaslessEffectIdentity, GaslessIntent, GaslessObservation, GaslessSnapshot } from "./model.js";
import { type GaslessRpcCall } from "./rpc-codec.js";
export interface GaslessObservationContext {
    readonly chainId: GaslessChainId;
    readonly rpcOrigin: string;
    readonly deployment: GaslessDeployment;
    readonly rpc: GaslessRpcCall;
    readonly bundler?: GaslessRpcCall;
    /** Retained for existing callers; canonical observation never uses an execution snapshot. */
    readonly snapshot?: (owner: Address) => Promise<GaslessSnapshot>;
}
export declare function observeGasless(context: GaslessObservationContext, intent: GaslessIntent, identity: GaslessEffectIdentity, cursorInput: GaslessCursor): Promise<GaslessObservation>;
