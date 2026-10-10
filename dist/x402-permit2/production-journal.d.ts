import type { Permit2NativeRequestExecution, Permit2NativeSigningExecution } from "./production-native-capability.js";
import { type Permit2ForegroundApprovalProof, type Permit2ApprovalBinding } from "./production-approval-provenance.js";
export interface Permit2SigningContinuation {
    readonly kind: "permit2-private-signing-continuation";
}
interface FirstRequestProof {
    readonly kind: "permit2-private-first-request-proof";
}
import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import { Permit2ProductionPreparation } from "./production-prepare.js";
import { Permit2ProductionRepository, type Permit2ProductionRecord } from "./production-repository.js";
import { type Permit2ProductionSigned } from "./production-signed.js";
import { type Permit2ObservationProof, type Permit2ObservationMode } from "./production-observer.js";
/** Storage/accounting only. No key, signing, transport or execution permission is returned. */
export declare class Permit2ProductionJournal extends Permit2ProductionRepository {
    #private;
    private readonly preparation;
    private readonly clock;
    static markNativeRequestPending(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeRequestExecution): Promise<{
        readonly record: Permit2ProductionRecord;
        readonly proof: FirstRequestProof | null;
    }>;
    static consumeNativeFirstRequestProof(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeRequestExecution, proof: FirstRequestProof): Permit2ProductionRecord;
    static claimNativeSigningContinuation(journal: Permit2ProductionJournal, id: string, continuation: Permit2SigningContinuation, execution: Permit2NativeSigningExecution): Promise<Permit2ProductionRecord>;
    static assertNativeSigningContinuation(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeSigningExecution): Promise<Permit2ProductionRecord>;
    static nativeSigningSecond(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeSigningExecution, capturedAt?: number): number;
    static nativeOriginBinding(journal: Permit2ProductionJournal, id: string, execution: Permit2NativeSigningExecution): Readonly<{
        binding: Permit2ApprovalBinding;
        record: Permit2ProductionRecord;
        lease: AssetUsageReservation;
    }>;
    static releaseNativeSigningContinuation(journal: Permit2ProductionJournal, execution: Permit2NativeSigningExecution): void;
    static storeNativeSigned(journal: Permit2ProductionJournal, id: string, value: Permit2ProductionSigned): Promise<Permit2ProductionRecord>;
    private readonly state;
    private readonly usage;
    constructor(root: string, preparation: Permit2ProductionPreparation, clock?: () => Date);
    /** Initial admission checks current owner. Replays can only reconcile the existing durable hold. */
    markSignatureRisk(id: string): Promise<Permit2ProductionRecord>;
    /** Genuine UI + atomic first insertion only. No key/sign/HTTP permission is conveyed. */
    markApprovedSignatureRisk(id: string, proof: Permit2ForegroundApprovalProof): Promise<{
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
export {};
