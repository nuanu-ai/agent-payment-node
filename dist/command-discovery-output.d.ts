import type { OutputEnvelope } from "./commands.js";
import type { ApnError } from "./errors.js";
export declare function usageFailureEnvelope(error: {
    readonly code: ApnError["code"];
    readonly message: string;
}, nextActions: readonly string[]): OutputEnvelope;
