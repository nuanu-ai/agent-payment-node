import { type Permit2ObservationMetrics } from "./production-observer-rpc.js";
import { type Permit2SigningMode } from "./production-signing-owner.js";
import { type Permit2MetadataLockScope } from "./production-signing-scope.js";
export type { Permit2MetadataLockScope } from "./production-signing-scope.js";
export type { Permit2SigningMode } from "./production-signing-owner.js";
export interface Permit2SigningFact {
    readonly kind: "checked-permit2-signing-observation";
}
export interface Permit2SigningProjection {
    readonly operationId: string;
    readonly mode: Permit2SigningMode;
    readonly outcome: "checked" | "hold";
    readonly operationDigest: string | null;
    readonly recordHash: string | null;
    readonly materialHash: string | null;
    readonly walletHash: string | null;
    readonly requestHash: string | null;
    readonly challengeHash: string | null;
    readonly originalLeaseDigest: string | null;
    readonly currentLeaseDigest: string | null;
    readonly capturedAt: string | null;
    readonly blockNumber: string | null;
    readonly blockHash: string | null;
    readonly rpc: Permit2ObservationMetrics;
}
/** Actual read-only observation only. Never human approval, custody permission, or transport authority. */
export declare class Permit2ProductionSigningFence {
    #private;
    constructor(root: string, endpoint: string, clock?: () => Date);
    static assertNativeScope(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string): void;
    static withNativeScope<T>(fence: Permit2ProductionSigningFence, root: string, id: string, action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T>;
    static nativeScopeOwner(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string): Promise<{
        record: import("./production-repository.js").Permit2ProductionRecord;
        lease: import("../asset-usage-ledger-types.js").AssetUsageReservation;
    }>;
    static checkNativeScoped(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string): Promise<{
        readonly projection: Permit2SigningProjection;
        readonly fact: Permit2SigningFact | null;
    }>;
    static consumeNativeScoped(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, fact: Permit2SigningFact, root: string, id: string): Promise<Permit2SigningProjection>;
    static assertNativeDispatchScope(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string): void;
    static assertNativeDispatchTime(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string, at: Date): void;
    static withNativeDispatchScope<T>(fence: Permit2ProductionSigningFence, root: string, id: string, action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T>;
    static nativeDispatchScopeOwner(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string): Promise<{
        record: import("./production-repository.js").Permit2ProductionRecord;
        lease: import("../asset-usage-ledger-types.js").AssetUsageReservation;
    }>;
    check(operationId: string, mode: Permit2SigningMode): Promise<{
        readonly projection: Permit2SigningProjection;
        readonly fact: Permit2SigningFact | null;
    }>;
    /** Scope owns actual metadata locks only; the callback receives no key/signing grant. */
    withScope<T>(operationId: string, mode: Permit2SigningMode, action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T>;
    checkScoped(scope: Permit2MetadataLockScope, operationId: string, mode: Permit2SigningMode): Promise<{
        readonly projection: Permit2SigningProjection;
        readonly fact: Permit2SigningFact | null;
    }>;
    /** Single-use private provenance; owned lifecycle/lease/owner and trusted age are rechecked, never caller facts. */
    consume(fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningProjection>;
    consumeScoped(scope: Permit2MetadataLockScope, fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningProjection>;
}
