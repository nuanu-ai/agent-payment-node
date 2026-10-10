import type { HttpsBaseRpc } from "../rpc.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
export declare const BASE_RELAY_DEPOSITORY_HASH = "0x77df38a47ee0c4453bc1bdc5f322712f0104ba1d97c4798dd49f16d4ed2e6256";
export declare const BASE_RELAY_SIGNED_BYTES = 512;
export declare function verifyRelayBaseFunding(op: RelayUnsignedOperation, rpc: Pick<HttpsBaseRpc, "batchCall">, tag: string): Promise<void>;
