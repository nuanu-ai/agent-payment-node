import type { HttpsBaseRpc } from "../rpc.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
export declare const BASE_RELAY_SIGNED_BYTES = 512;
/** P5: the depository address is pinned by the saved quote validation and the exact deposit is simulated here; its
 * runtime code hash is not re-read on every funding check. */
export declare function verifyRelayBaseFunding(op: RelayUnsignedOperation, rpc: Pick<HttpsBaseRpc, "batchCall">, tag: string): Promise<void>;
