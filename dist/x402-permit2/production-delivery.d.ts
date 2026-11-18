import { type Permit2HttpLocatorHint } from "./production-http-observations.js";
import { type Permit2ProductionRecord } from "./production-repository.js";
/** Why a sent paid request has no confirmed seller answer. */
export type Permit2DeliveryReason = 
/** No answer is recorded: the request timed out, the transport refused it, it is still running, or saving it failed. */
"no_answer"
/** The saved answer record exists but cannot be read or does not match the operation. */
 | "answer_unreadable"
/** The answer was recorded by 0.5.107–0.5.109, which kept no body hash. */
 | "answer_before_0_5_110"
/** The seller answered outside 2xx. */
 | "answer_not_2xx"
/** The answer's PAYMENT-RESPONSE was a failure, malformed, or named another network, payer or amount. */
 | "payment_response_refused"
/** The answer named a transaction other than the settled one. */
 | "answer_names_other_transaction";
/**
 * The seller's answer to the one paid request, apart from payment. `state` of the operation says whether it is paid
 * (`settled`); this says whether the seller delivered. `received`: a 2xx answer whose PAYMENT-RESPONSE, if present, is a
 * success or pending one for this network (and this payer and amount where it names them) and, once a settlement with a
 * known transaction is recorded, names that transaction. `resultHash` is
 * the body's hash by the x402 result rule (`apn.x402.result-body.v1`); APN keeps no body. `unconfirmed`: a request was
 * sent but no such answer is recorded, and `reason` says why. `not_requested`: no paid request was sent.
 */
export interface Permit2Delivery {
    readonly state: "not_requested" | "unconfirmed" | "received";
    readonly reason: Permit2DeliveryReason | null;
    readonly httpStatus: number | null;
    readonly resultHash: string | null;
    readonly byteLength: string | null;
}
export declare function permit2Delivery(record: Permit2ProductionRecord, hint: Permit2HttpLocatorHint | null | "unreadable"): Permit2Delivery;
/** Reads the saved answer only when a request was sent; no locks, writes or network. */
export declare function readPermit2Delivery(root: string, record: Permit2ProductionRecord): Promise<Permit2Delivery>;
/** The public view of one operation with its delivery: what every status, approve and observe answer shows. */
export declare function projectPermit2Production(root: string, record: Permit2ProductionRecord): Promise<{
    delivery: Permit2Delivery;
    lifecycle: string;
    observeOnly: boolean;
    operationId: string;
    state: "prepared" | "reserved" | "released_unsubmitted" | "settled" | "reserving" | "release_pending" | "exposure_unknown" | "request_pending" | "terminal_pending" | "expired_no_effect";
    terminal: boolean;
    capability: string;
    chain: `eip155:${number}`;
    payer: `0x${string}`;
    token: `0x${string}`;
    recipient: `0x${string}`;
    amountAtomic: string;
    deadline: string;
    resource: {
        origin: string;
        urlHash: string;
    };
    blockerCodes: string[];
}>;
export type Permit2PublicStatus = Awaited<ReturnType<typeof projectPermit2Production>>;
