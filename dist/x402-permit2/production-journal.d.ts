import { Permit2ProductionPreparation } from "./production-prepare.js";
import { Permit2ProductionRepository, type Permit2ProductionRecord } from "./production-repository.js";
import { type Permit2ProductionSigned } from "./production-signed.js";
import { type Permit2ObservationProof, type Permit2ObservationMode } from "./production-observer.js";
/** Storage/accounting only. No key, signing, transport or execution permission is returned. */
export declare class Permit2ProductionJournal extends Permit2ProductionRepository {
    private readonly preparation;
    private readonly clock;
    private readonly state;
    private readonly usage;
    constructor(root: string, preparation: Permit2ProductionPreparation, clock?: () => Date);
    private now;
    private locks;
    private required;
    private lease;
    private save;
    /** Initial admission checks current owner. Replays can only reconcile the existing durable hold. */
    markSignatureRisk(id: string): Promise<Permit2ProductionRecord>;
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
