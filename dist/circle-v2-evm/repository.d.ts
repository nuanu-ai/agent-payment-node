import { type CircleKnownOperation, type CircleFundingOperationV2 } from "./funding-operation.js";
import { SecureStateStore } from "../secure-state-store.js";
/** All writes require the caller's shared profile, idempotency, operation and owner locks. */
export declare class CircleRepository extends SecureStateStore {
    loadAny(operationId: string): Promise<CircleKnownOperation | null>;
    listAllAny(): Promise<readonly CircleKnownOperation[]>;
    saveFunding(input: CircleFundingOperationV2): Promise<void>;
}
export declare function validateCircleFundingAdvance(previous: CircleFundingOperationV2, next: CircleFundingOperationV2): void;
