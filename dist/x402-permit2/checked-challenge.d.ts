import { type X402PaymentRequired } from "../x402-codec.js";
import { type X402HttpRequestV1 } from "../x402-http-request.js";
export interface Permit2CheckedChallenge {
    readonly challenge: X402PaymentRequired;
    readonly challengeHash: string;
    readonly request: X402HttpRequestV1;
    readonly requestHash: string;
}
/**
 * Internal checked inspection material; no private request is added to public inspection output. The seller's resource
 * must name the requested endpoint by the rule every x402 lane uses (same origin and path; query and fragment may differ).
 */
export declare function checkPermit2Challenge(challenge: X402PaymentRequired, requestValue: unknown): Permit2CheckedChallenge;
export declare function validatePermit2CheckedChallenge(value: unknown): Permit2CheckedChallenge;
