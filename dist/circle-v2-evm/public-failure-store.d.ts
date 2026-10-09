import { SecureStateStore } from "../secure-state-store.js";
import { type CircleOperationV1, type CircleRole } from "./operation-model.js";
export declare function sanitizedCircleFailure(details: unknown): Record<string, string | number>;
/** First public classified failure only: never request bodies, RPC params, key or material bytes. */
export declare class CirclePublicFailureStore extends SecureStateStore {
    private path;
    read(op: CircleOperationV1): Promise<unknown | null>;
    record(op: CircleOperationV1, role: CircleRole, error: unknown): Promise<void>;
}
