/** Circle V2 BaseTokenMessenger._mintAndWithdraw: net mint, optional issuer mint, then aggregate event.
 * All inputs remain public observations; the caller must authenticate the historical feeRecipient getter. */
import { type Address } from "viem";
import { type CircleAttestation, type CircleObservation } from "./protocol.js";
export declare function decodeCircleMintEvents(attested: CircleAttestation, observation: CircleObservation, feeRecipient?: Address): void;
