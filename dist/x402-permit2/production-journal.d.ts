import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import { Permit2ProductionPreparation } from "./production-prepare.js";
import { Permit2ProductionRepository, type Permit2ProductionRecord } from "./production-repository.js";
import { type Permit2ProductionSigned } from "./production-signed.js";
import { type Permit2ObservationProof, type Permit2ObservationMode } from "./production-observer.js";
import { type Permit2ForegroundApproval } from "./production-approval-provenance.js";
import { type Permit2SavedIdentity } from "./production-signing-owner.js";
/**
 * What an approved first exposure hands to the one signer: the owner's approval and the identity of the saved record
 * and lease it was written under. Plain values with no private material: the signer re-reads both and signs only while
 * they are unchanged.
 */
export interface Permit2SigningContinuation {
    readonly approval: Permit2ForegroundApproval;
    readonly saved: Permit2SavedIdentity;
}
/** A saved signed bundle under the owner's approval: the signed hash one request may send, and its lease. */
export interface Permit2SignedOrigin {
    readonly approval: Permit2ForegroundApproval;
    readonly signedHash: string;
    readonly leaseDigest: string;
    readonly walletHash: string;
}
/** Storage/accounting only. No key, signing, transport or execution permission is returned. */
export declare class Permit2ProductionJournal extends Permit2ProductionRepository {
    #private;
    private readonly preparation;
    private readonly clock;
    /**
     * Writes attempt 1, the single durable request marker, for the saved signed bundle the origin names, while its paid
     * approval is current. `first` is true only for the call that wrote it: only that call may send.
     */
    markFirstRequest(origin: Permit2SignedOrigin, clock: () => Date): Promise<{
        readonly record: Permit2ProductionRecord;
        readonly first: boolean;
    }>;
    private readonly state;
    private readonly usage;
    constructor(root: string, preparation: Permit2ProductionPreparation, clock?: () => Date);
    /**
     * R4 exit of an authorization never exposed: once its deadline has passed (by the family clock), the family's own
     * expiry release proves it unsigned, frees its usage hold and ends it `released_unsubmitted`; before that it refuses.
     */
    releaseUnexposedExpired(id: string): Promise<Permit2ProductionRecord>;
    /** Initial admission checks current owner. Replays can only reconcile the existing durable hold. */
    markSignatureRisk(id: string): Promise<Permit2ProductionRecord>;
    /**
     * The first exposure under the owner's current foreground approval. Only the call that writes it receives a signing
     * continuation; every replay, and any exposure written without an approval, gets status only.
     */
    markApprovedSignatureRisk(id: string, approval: Permit2ForegroundApproval): Promise<{
        readonly record: Permit2ProductionRecord;
        readonly continuation: Permit2SigningContinuation | null;
    }>;
    /** No state locks span ledger I/O; risk remains durable if either side fails. */
    confirmHold(id: string): Promise<Permit2ProductionRecord>;
    storeSigned(id: string, value: Permit2ProductionSigned): Promise<Permit2ProductionRecord>;
    /** Attempt 1 is the sole durable request marker; it conveys no HTTP permission. */
    markRequestPending(id: string): Promise<Permit2ProductionRecord>;
    /** Only an actual observer's private, single-use capability can create or renew terminal authority. */
    finalize(id: string, proof: Permit2ObservationProof, mode: Permit2ObservationMode): Promise<Permit2ProductionRecord>;
    /** Persisted intent is sufficient ONLY to match an already-terminal ledger, never to decide a new transition. */
    reconcileTerminal(id: string): Promise<Permit2ProductionRecord>;
}
/** The saved record still carries the origin's signed bundle under the same lease and wallet binding. */
export declare function assertSignedOrigin(origin: Permit2SignedOrigin, record: Permit2ProductionRecord, lease: AssetUsageReservation): void;
