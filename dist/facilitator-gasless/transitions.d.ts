import { type FacilitatorIntent, type FacilitatorMutable, type FacilitatorOperationRecord } from "./operation-model.js";
export declare function facilitatorSame(left: unknown, right: unknown): boolean;
export declare function newFacilitatorOperation(input: {
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly intent: FacilitatorIntent;
}): FacilitatorOperationRecord;
export declare function transitionFacilitator(op: FacilitatorOperationRecord, patch: Partial<FacilitatorMutable>, at: string): FacilitatorOperationRecord;
export declare function facilitatorAtTransition(op: FacilitatorOperationRecord, index: number): FacilitatorOperationRecord;
export declare function validateFacilitatorOperation(value: unknown): FacilitatorOperationRecord;
export declare function validateFacilitatorContinuity(previous: FacilitatorOperationRecord, next: FacilitatorOperationRecord): void;
