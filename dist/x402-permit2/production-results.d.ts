import { StateStore } from "../state.js";
import { Permit2ProductionJournal } from "./production-journal.js";
import { type Permit2ObservationMode, type Permit2ObservationProjection } from "./production-observer.js";
import { publicPermit2Production } from "./production-repository.js";
type Status = ReturnType<typeof publicPermit2Production> | null;
type Code = "not_found" | "state_unavailable" | "hint_saved" | "hint_unavailable" | "not_exposed" | "terminal" | "held" | "invalid_candidate" | "invalid_mode" | "owner_mismatch" | "observed_hold" | "finalized" | "reconciled";
export interface Permit2ProductionResult {
    readonly status: Status;
    readonly code: Code;
    readonly observation?: Permit2ObservationProjection;
}
/** Result handling only. Sidecar content never supplies a proof, grant or accounting decision. */
export declare class Permit2ProductionResults {
    #private;
    constructor(state: StateStore, journal: Permit2ProductionJournal);
    recordHttp(id: string, observation: unknown): Promise<Permit2ProductionResult>;
    observe(id: string, rpcUrl: string, mode?: Permit2ObservationMode, candidate?: string): Promise<Permit2ProductionResult>;
}
export {};
