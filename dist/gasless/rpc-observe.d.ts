import type { Address } from "../model.js";
import type { GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessIntent, GaslessObservation, GaslessSnapshot } from "./model.js";
import { type GaslessRpcCall } from "./rpc-codec.js";
export interface GaslessObservationContext {
    readonly chainId: GaslessChainId;
    readonly rpcOrigin: string;
    readonly rpc: GaslessRpcCall;
    readonly bundler?: GaslessRpcCall;
    /** Retained for existing callers; canonical observation never uses an execution snapshot. */
    readonly snapshot?: (owner: Address) => Promise<GaslessSnapshot>;
}
/**
 * Archive-free observation. Effects are proven by the authenticated receipt logs and header membership; a settlement
 * reads account state only at the latest head, and the permission-invalidation probe at the safe (Polygon: finalized)
 * and latest heads; never at the prepare, inclusion or scan-cursor block, whose state a keyless node no longer serves.
 */
export declare function observeGasless(context: GaslessObservationContext, intent: GaslessIntent, identity: GaslessEffectIdentity, cursorInput: GaslessCursor): Promise<GaslessObservation>;
