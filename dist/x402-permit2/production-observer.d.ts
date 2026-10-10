import { type Permit2ProductionRecord } from "./production-repository.js";
import { type Permit2ProductionSigned } from "./production-signed.js";
import { type Permit2ObservationMetrics } from "./production-observer-rpc.js";
export type Permit2ObservationMode = "settlement" | "expired_unused";
/** Only the private map supplies authority. Serialization and cloning cannot mint a proof. */
export interface Permit2ObservationProof {
    readonly kind: "checked-permit2-production-observation";
}
export interface Permit2ObservationProjection {
    readonly mode: Permit2ObservationMode;
    readonly outcome: "hold" | "settled" | "expired_unused";
    readonly reason: "checked" | "reverted_locator" | "unavailable_or_mismatch";
    readonly operationDigest: string;
    readonly materialHash: string;
    readonly requestHash: string;
    readonly challengeHash: string;
    readonly signedHash: string | null;
    readonly transactionHash: string | null;
    readonly blockNumber: string | null;
    readonly blockHash: string | null;
    readonly tokenPermitOutcome: "not_requested" | "not_proven" | null;
    readonly rpc: Permit2ObservationMetrics;
}
export interface Permit2ProductionObservationInput {
    readonly profile: string;
    readonly stateRoot: string;
    readonly rpcUrl: string;
    readonly record: Permit2ProductionRecord;
    readonly signed: Permit2ProductionSigned | null;
    readonly mode: Permit2ObservationMode;
    readonly locator: string | null;
}
export interface Permit2ProductionObservation {
    readonly projection: Permit2ObservationProjection;
    readonly proof: Permit2ObservationProof | null;
}
/** Actual finite canonical observer only. No effect, journal, policy-admission or accounting mutation. */
export declare function observePermit2Production(input: Permit2ProductionObservationInput): Promise<Permit2ProductionObservation>;
/** Later lifecycle code must consume this private capability, bound to the unchanged frozen operation and mode. */
export declare function consumePermit2ObservationProof(proof: Permit2ObservationProof, record: Permit2ProductionRecord, supplied: Permit2ProductionSigned | null, mode: Permit2ObservationMode): Promise<Permit2ObservationProjection>;
