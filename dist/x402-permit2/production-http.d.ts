import type { HttpObservation } from "../x402-model.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
/** One dispatch attempt, live only while its sender holds the operation's dispatch locks and its 20 s deadline. */
export interface Permit2HttpAttempt {
    /** The saved request-pending record whose signed header is sent. */
    readonly record: Permit2ProductionRecord;
    readonly signal: AbortSignal;
    /** Throws unless the deadline, the paid approval, the owner policy and the signing window still hold. */
    assertCurrent(): void;
    /** Re-reads the saved record and lease under the held locks; throws unless they are unchanged. */
    owner(): Promise<void>;
    /** Each stage once, in order: construct the request, then end it with the body. */
    step(stage: "construct" | "end"): void;
}
/** Concrete single-attempt transport for one attempt that sendPermit2Production admitted. */
export declare class Permit2ProductionHttps {
    submit(attempt: Permit2HttpAttempt): Promise<HttpObservation>;
}
