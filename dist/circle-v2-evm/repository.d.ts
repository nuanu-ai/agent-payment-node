import { SecureStateStore } from "../secure-state-store.js";
import { type CircleOperationV1 } from "./operation-model.js";
/** All writes require the caller's shared profile, idempotency, operation and owner locks. */
export declare class CircleRepository extends SecureStateStore {
    load(operationId: string): Promise<CircleOperationV1 | null>;
    listAllOperations(): Promise<readonly CircleOperationV1[]>;
    listOperations(profileHash: string): Promise<readonly CircleOperationV1[]>;
    save(input: CircleOperationV1): Promise<void>;
}
export declare function validateCircleAdvance(previous: CircleOperationV1, next: CircleOperationV1): void;
