import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateEvmNativeCustody } from "../evm-native-custody.js";
export function validateCircleNativeAdmission(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "recipientCustody", "sources"]) ||
        value.schemaVersion !== "apn.circle-finalized-native-admission.v1" || !Array.isArray(value.sources) || value.sources.length !== 1)
        blocked();
    validateEvmNativeCustody(value.recipientCustody);
    for (const source of value.sources)
        if (!isPlainRecord(source) || !exactKeys(source, ["operationId", "sourceIdentityHash"]) ||
            ![source.operationId, source.sourceIdentityHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)))
            blocked();
    return value;
}
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Finalized Circle source admission is unavailable or changed; retain the existing source holds."); }
//# sourceMappingURL=circle-native-admission-rider.js.map