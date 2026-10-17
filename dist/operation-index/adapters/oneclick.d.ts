import { type OneClickSourceRecord } from "../../lifi/near-oneclick-source-journal.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * NEAR 1Click source transfers: the payer signs one transaction on the lane's origin chain, only before the effective
 * deposit deadline, and a sealed transaction is sent only by the command that sealed it. The record ends at its own
 * outcomes, through status: a safe source receipt (`source_observed`), or `failed_proven_superseded` once the payer's
 * finalized nonce is past the source nonce while the node knows neither the transaction nor a receipt.
 *
 * The payer's account is also released when the deposit deadline plus the unstarted margin has passed (phase 4c
 * re-check, kept): (1) every signed source carries one fixed nonce, so it and any later transaction at that nonce cannot
 * both land, and the family's own nonce reservation lets a new 1Click deposit take that nonce only after the deadline
 * and while the node does not know the old hash; (2) the release is what lets a later transaction consume the nonce at
 * all, which is the proof status needs to end the record; until then a late landing is still observed by status as
 * `source_observed` (the quote is dead, so 1Click refunds that deposit to the payer, its refund address).
 */
export declare const oneClickSourceAdapter: OperationFamilyAdapter<OneClickSourceRecord>;
