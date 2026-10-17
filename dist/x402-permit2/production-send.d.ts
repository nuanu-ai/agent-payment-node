import type { HttpObservation } from "../x402-model.js";
import { Permit2ProductionHttps } from "./production-http.js";
import { type Permit2ProductionJournal, type Permit2SignedOrigin } from "./production-journal.js";
import { publicPermit2Production } from "./production-repository.js";
import type { Permit2ProductionSigningFence } from "./production-signing-fence.js";
export declare const PERMIT2_HTTP_DEADLINE_MS = 20000;
export type Permit2SendOutcome = {
    readonly kind: "observed";
    readonly observation: HttpObservation;
} | {
    readonly kind: "held";
};
export interface Permit2SendResult {
    readonly status: ReturnType<typeof publicPermit2Production>;
    /** Null when this call did not write the request marker: it sent nothing. */
    readonly outcome: Permit2SendOutcome | null;
}
/**
 * Sends a saved signed bundle at most once. Under the dispatch locks it checks the current owner, then writes attempt 1,
 * the durable request marker; only the call that wrote the marker makes the one HTTPS attempt, within 20 s and under the
 * same locks, and the marker stays whatever happens. A refusal before the marker throws; after it the result is held.
 */
export declare function sendPermit2Production(journal: Permit2ProductionJournal, fence: Permit2ProductionSigningFence, origin: Permit2SignedOrigin, clock: () => Date, https?: Permit2ProductionHttps): Promise<Permit2SendResult>;
