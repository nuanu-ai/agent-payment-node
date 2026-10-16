import type { GaslessBlock, GaslessCursor, GaslessEffectIdentity, GaslessIntent, GaslessObservation } from "./model.js";
import type { GaslessObservationContext } from "./rpc-observe.js";
/**
 * Proves a disclosed permission can no longer be used, from current state only: the account at the current safe
 * (Polygon: finalized) head and at the latest head, read together in one request. A final seal is closed only after the
 * canonical no-event scan reached that same safe head (`scannedSafe`), so its proof block is the scan's end. The
 * contracts and protocol hash are the intent's own, so a later registry pin update cannot strand the proof.
 */
export declare function observeGaslessBootstrap(context: GaslessObservationContext, intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor, scannedSafe?: GaslessBlock): Promise<GaslessObservation>;
