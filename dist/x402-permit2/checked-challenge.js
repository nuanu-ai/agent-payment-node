import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { decodePaymentRequiredHeader, encodePaymentRequiredHeader } from "../x402-codec.js";
import { normalizeX402HttpRequest } from "../x402-http-request.js";
import { hashChallenge } from "./prepare.js";
/** Internal checked inspection material; no private request is added to public inspection output. */
export function checkPermit2Challenge(challenge, requestValue) {
    const request = normalizeX402HttpRequest(requestValue);
    const checked = decodePaymentRequiredHeader(encodePaymentRequiredHeader(challenge));
    if (checked.resource.url !== request.url || canonicalJson(checked) !== canonicalJson(challenge)) {
        throw new ApnError("APN_INVALID_INPUT", "The checked challenge does not bind the exact merchant request.");
    }
    return { challenge: checked, challengeHash: hashChallenge(checked), request,
        requestHash: domainHash("apn.http-request.v1", canonicalJson(request)) };
}
export function validatePermit2CheckedChallenge(value) {
    try {
        if (!isPlainRecord(value) || !exactKeys(value, ["challenge", "challengeHash", "request", "requestHash"]))
            throw new Error();
        const checked = checkPermit2Challenge(value.challenge, value.request);
        if (canonicalJson(checked) !== canonicalJson(value))
            throw new Error();
        return checked;
    }
    catch {
        throw new ApnError("APN_STATE_CORRUPT", "Checked Permit2 challenge material is corrupt.");
    }
}
//# sourceMappingURL=checked-challenge.js.map