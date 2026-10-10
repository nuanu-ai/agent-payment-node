import { type CircleOperationV1 } from "./operation-model.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import type { CircleRpc } from "./rpc.js";
/** Only frozen cleanup85/86 proof replay. Initial admission continues to use the stricter current
 * account checks. Later legitimate account activity cannot invalidate canonical historical state. */
export declare function verifyCleanup85HistoricalAcceptance(source: CircleRpc, op: CircleOperationV1, proof: CircleNonceRetirementProof): Promise<void>;
