import { type OneClickSourceRecord } from "../../lifi/near-oneclick-source-journal.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * NEAR 1Click source transfers: the payer signs one transaction on the lane's origin chain, only before the effective
 * deposit deadline, and a sealed transaction is sent only by the command that sealed it. The payer is held until the
 * source receipt is observed at finality, or until the deposit deadline (plus the unstarted margin) has passed: the
 * quote is then dead (a late deposit is refunded to the payer) and the family's own nonce rule already lets a new
 * operation take the nonce of an ambiguous send, so at most one transaction can use it.
 */
export declare const oneClickSourceAdapter: OperationFamilyAdapter<OneClickSourceRecord>;
