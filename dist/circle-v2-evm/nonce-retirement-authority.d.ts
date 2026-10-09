import { SecureStateStore } from "../secure-state-store.js";
import { type CircleOperationV1, type CirclePolicy } from "./operation-model.js";
export interface CircleRetirementAuthority {
    readonly version: "apn.circle-retirement-authority.v1";
    readonly operationId: string;
    readonly parentBinding: string;
    readonly sourceCustody: CircleOperationV1["sourceCustody"];
    readonly destinationCustody: CircleOperationV1["destinationCustody"];
    readonly policies: readonly CirclePolicy[];
    readonly windowEndsAt: string | null;
    readonly capturedAt: string;
    readonly authorityHash: string;
}
export declare class CircleRetirementAuthorityStore extends SecureStateStore {
    private path;
    load(op: CircleOperationV1): Promise<CircleRetirementAuthority | null>;
    capture(op: CircleOperationV1, policies: readonly CirclePolicy[], windowEndsAt: string | null, now: number): Promise<CircleRetirementAuthority>;
}
export declare function assertCircleRetirementWindow(frame: CircleRetirementAuthority, now: number): void;
