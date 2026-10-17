import { type CircleKnownOperation, type CircleFundingOperationV2 } from "./funding-operation.js";
import { SecureStateStore } from "../secure-state-store.js";
import { type CircleOperationV1 } from "./operation-model.js";
/** All writes require the caller's shared profile, idempotency, operation and owner locks. */
export declare class CircleRepository extends SecureStateStore {
    loadAny(operationId: string): Promise<CircleKnownOperation | null>;
    /** Legacy callers cannot adopt, recover or execute a funding-v2 ID. */
    load(operationId: string): Promise<CircleOperationV1 | null>;
    listAllAny(): Promise<readonly CircleKnownOperation[]>;
    listAny(profileHash: string): Promise<readonly CircleKnownOperation[]>;
    save(input: CircleOperationV1): Promise<void>;
    saveFunding(input: CircleFundingOperationV2): Promise<void>;
}
export declare function validateCircleAdvance(previous: CircleOperationV1, next: CircleOperationV1): void;
export declare function validateCircleFundingAdvance(previous: CircleFundingOperationV2, next: CircleFundingOperationV2): void;
