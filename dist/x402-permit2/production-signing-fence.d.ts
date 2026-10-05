import { type Permit2ObservationMetrics } from "./production-observer-rpc.js";
import { type Permit2SigningMode } from "./production-signing-owner.js";
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
    private readonly endpoint;
    private readonly clock;
    private readonly state;
    private readonly records;
    constructor(root: string, endpoint: string, clock?: () => Date);
    private now;
    check(operationId: string, mode: Permit2SigningMode): Promise<{
        readonly projection: Permit2SigningProjection;
        readonly fact: Permit2SigningFact | null;
    }>;
    /** Single-use private provenance; owned lifecycle/lease/owner and trusted age are rechecked, never caller facts. */
    consume(fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningProjection>;
}
