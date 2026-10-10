import { type DirectAllowlistBinding } from "./direct-allowlist-gate.js";
import { SecureStateStore } from "./secure-state-store.js";
export interface RailPrepareClaim {
    readonly schemaVersion: "apn.rail-prepare-claim.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly inputHash: string;
    readonly requestHash: string;
    readonly accountIdentityHash: string;
    readonly policyHash: string;
    readonly allowlist: DirectAllowlistBinding;
    readonly integrityHash: string;
}
export declare function sealPrepareClaim(body: Omit<RailPrepareClaim, "integrityHash">): RailPrepareClaim;
export declare class RailPrepareClaimStore extends SecureStateStore {
    private initialized;
    private ready;
    private path;
    load(idempotencyHash: string): Promise<RailPrepareClaim | null>;
    create(claim: RailPrepareClaim): Promise<void>;
    remove(idempotencyHash: string): Promise<void>;
    removeIfMatches(claim: RailPrepareClaim): Promise<void>;
}
export interface RailApprovalClaim {
    readonly schemaVersion: "apn.rail-approval-claim.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly fingerprint: string;
    readonly accountIdentityHash: string;
    readonly policyHash: string;
    readonly allowlist: DirectAllowlistBinding;
    readonly integrityHash: string;
}
export declare function sealApprovalClaim(body: Omit<RailApprovalClaim, "integrityHash">): RailApprovalClaim;
export declare class RailApprovalClaimStore extends SecureStateStore {
    private initialized;
    private ready;
    private path;
    load(operationId: string): Promise<RailApprovalClaim | null>;
    create(claim: RailApprovalClaim): Promise<void>;
    removeIfMatches(claim: RailApprovalClaim): Promise<void>;
}
