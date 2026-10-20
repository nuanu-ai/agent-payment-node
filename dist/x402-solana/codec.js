import { getTransactionDecoder } from "@solana/kit";
import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { X402_SOLANA_NETWORK } from "./constants.js";
import { solanaExactOffers } from "./offer.js";
/** True when a PaymentPayload's `accepted` names Solana mainnet; the generic EVM payload rules then do not apply. */
export function isSolanaAccepted(accepted) {
    return isPlainRecord(accepted) && accepted.network === X402_SOLANA_NETWORK;
}
/**
 * The x402 v2 SVM `exact` PaymentPayload APN sends: no extensions, `accepted` one Solana exact offer, and a payload
 * that is exactly one base64 partially signed transaction of at most one packet with two signature slots.
 */
export function validateSolanaPaymentPayload(value) {
    const offers = solanaExactOffers([value.accepted]);
    if (!exactKeys(value, ["x402Version", "resource", "accepted", "payload"]) || offers.length !== 1 ||
        !isPlainRecord(value.payload) || !exactKeys(value.payload, ["transaction"]) || typeof value.payload.transaction !== "string")
        invalid();
    const encoded = value.payload.transaction, bytes = Buffer.from(encoded, "base64");
    if (bytes.length === 0 || bytes.length > 1232 || bytes.toString("base64") !== encoded)
        invalid();
    try {
        if (Object.keys(getTransactionDecoder().decode(bytes).signatures).length !== 2)
            invalid();
    }
    catch {
        invalid();
    }
}
function invalid() { throw new ApnError("APN_HTTP_PROTOCOL", "PAYMENT-SIGNATURE Solana exact payload shape is invalid."); }
//# sourceMappingURL=codec.js.map