import { type Permit2ObservationMetrics } from "./production-observer-rpc.js";
import { type Permit2MetadataMode, type Permit2SavedIdentity, type Permit2SigningMode } from "./production-signing-owner.js";
import { type Permit2MetadataLockScope } from "./production-signing-scope.js";
export type { Permit2MetadataLockScope } from "./production-signing-scope.js";
export type { Permit2SigningMode } from "./production-signing-owner.js";
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
/** A checked observation: what the chain and the saved operation held at `capturedAt`. A plain value; consuming it
 * re-reads the saved record, lease and wallet binding and requires them unchanged and the observation under 5 s old. */
export type Permit2SigningFact = Permit2SigningProjection & {
    readonly outcome: "checked";
    readonly recordHash: string;
    readonly currentLeaseDigest: string;
    readonly walletHash: string;
    readonly capturedAt: string;
};
export declare const PERMIT2_SIGNING_FACT_MAX_AGE_MS = 5000;
/** Actual read-only observation only. Never human approval, custody permission, or transport authority. */
export declare class Permit2ProductionSigningFence {
    #private;
    constructor(root: string, endpoint: string, clock?: () => Date);
    get root(): string;
    check(operationId: string, mode: Permit2SigningMode): Promise<{
        readonly projection: Permit2SigningProjection;
        readonly fact: Permit2SigningFact | null;
    }>;
    /** Holds the operation's metadata locks around `action`; the scope grants no key, signing or transport. */
    withScope<T>(operationId: string, mode: Permit2MetadataMode, action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T>;
    checkScoped(scope: Permit2MetadataLockScope, operationId: string, mode: Permit2SigningMode): Promise<{
        readonly projection: Permit2SigningProjection;
        readonly fact: Permit2SigningFact | null;
    }>;
    /** The saved operation and lease, re-read under the held scope, optionally required to equal `expected`. */
    scopeOwner(scope: Permit2MetadataLockScope, operationId: string, mode: Permit2MetadataMode, expected?: Permit2SavedIdentity): Promise<{
        record: import("./production-repository.js").Permit2ProductionRecord;
        lease: import("../asset-usage-ledger-types.js").AssetUsageReservation;
    }>;
    /** Owner identity, policy, caps and the signing window at `at`, against what the held scope last read. */
    assertScopeTime(scope: Permit2MetadataLockScope, operationId: string, mode: Permit2MetadataMode, at: Date): void;
    /** Re-checks a fact: the saved record, lease and wallet binding are unchanged and the observation is under 5 s old. */
    consume(fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningFact>;
    consumeScoped(scope: Permit2MetadataLockScope, fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningFact>;
}
