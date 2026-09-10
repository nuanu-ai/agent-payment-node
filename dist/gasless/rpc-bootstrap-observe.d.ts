import type { GaslessCursor, GaslessEffectIdentity, GaslessIntent, GaslessObservation } from "./model.js";
import type { GaslessObservationContext } from "./rpc-observe.js";
export declare function observeGaslessBootstrap(context: GaslessObservationContext, intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation>;
