import { PERMIT2_HTTP_OBSERVATION_SCHEMA, Permit2HttpObservationStore, type Permit2HttpLocatorHint } from "./production-http-observations.js";
import { publicPermit2Production, type Permit2ProductionRecord } from "./production-repository.js";

/** Why a sent paid request has no confirmed seller answer. */
export type Permit2DeliveryReason =
  /** No answer is recorded: the request timed out, the transport refused it, or it is still running. */
  | "no_answer"
  /** The saved answer record exists but cannot be read or does not match the operation. */
  | "answer_unreadable"
  /** The answer was recorded by 0.5.107–0.5.109, which kept no body hash. */
  | "answer_before_0_5_110"
  /** The seller answered outside 2xx. */
  | "answer_not_2xx"
  /** The answer's PAYMENT-RESPONSE was a failure or did not match this payer, amount and network. */
  | "payment_response_refused"
  /** The answer named a transaction other than the settled one. */
  | "answer_names_other_transaction";

/**
 * The seller's answer to the one paid request, apart from payment. `state` of the operation says whether it is paid
 * (`settled`); this says whether the seller delivered. `received`: a 2xx answer whose PAYMENT-RESPONSE, if present, is a
 * matching success or pending one and, once settled with a known transaction, names that transaction. `resultHash` is
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

export function permit2Delivery(record: Permit2ProductionRecord, hint: Permit2HttpLocatorHint | null | "unreadable"): Permit2Delivery {
  const none = { httpStatus: null, resultHash: null, byteLength: null };
  if (record.exposureJournal?.request == null) return { state: "not_requested", reason: null, ...none };
  if (hint === "unreadable") return { state: "unconfirmed", reason: "answer_unreadable", ...none };
  if (hint === null) return { state: "unconfirmed", reason: "no_answer", ...none };
  if (hint.schemaVersion !== PERMIT2_HTTP_OBSERVATION_SCHEMA) {
    return { state: "unconfirmed", reason: "answer_before_0_5_110", ...none, httpStatus: hint.httpStatus };
  }
  const answer = { httpStatus: hint.httpStatus, resultHash: hint.bodyHash, byteLength: hint.bodyByteLength };
  if (hint.httpStatus < 200 || hint.httpStatus > 299) return { state: "unconfirmed", reason: "answer_not_2xx", ...answer };
  if (hint.classification === "failure_hint" || hint.classification === "invalid_response") {
    return { state: "unconfirmed", reason: "payment_response_refused", ...answer };
  }
  const settled = record.state === "settled" ? record.exposureJournal?.terminalIntent?.transactionHash ?? null : null;
  if (settled !== null && hint.locator !== null && settled.toLowerCase() !== hint.locator.toLowerCase()) {
    return { state: "unconfirmed", reason: "answer_names_other_transaction", ...answer };
  }
  return { state: "received", reason: null, ...answer };
}

/** Reads the saved answer only when a request was sent; no locks, writes or network. */
export async function readPermit2Delivery(root: string, record: Permit2ProductionRecord): Promise<Permit2Delivery> {
  if (record.exposureJournal?.request == null) return permit2Delivery(record, null);
  let hint: Permit2HttpLocatorHint | null | "unreadable";
  try { hint = await new Permit2HttpObservationStore(root).read(record.operationId, record); } catch { hint = "unreadable"; }
  return permit2Delivery(record, hint);
}

/** The public view of one operation with its delivery: what every status, approve and observe answer shows. */
export async function projectPermit2Production(root: string, record: Permit2ProductionRecord) {
  return { ...publicPermit2Production(record), delivery: await readPermit2Delivery(root, record) };
}
export type Permit2PublicStatus = Awaited<ReturnType<typeof projectPermit2Production>>;
