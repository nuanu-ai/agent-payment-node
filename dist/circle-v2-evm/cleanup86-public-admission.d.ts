import { type CircleObservation } from "./protocol.js";
import type { ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import type { CircleRpc } from "./rpc.js";
/** Historical full verification is retained only within the invocation. Every later boundary
 * reanchors those exact canonical blocks and reads a fresh complete anchored current account. */
export declare function recheckCleanup86Admission(source: CircleRpc, evidence: ConsumedBurnEvidence, cancellation: CircleObservation): Promise<void>;
