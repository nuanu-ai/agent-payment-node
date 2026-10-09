import { type CircleOperationV1 } from "./operation-model.js";
import { type CircleObservation } from "./protocol.js";
/** Only this consumed85 recovery may reconstruct a missing optional RPC field from its canonical header.
 * Present fields are never replaced; the complete historical transaction digest still has to match. */
export declare function consumedApprovalTimestamp(input: CircleObservation, op: CircleOperationV1): CircleObservation;
