import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SWAP_OPERATION_SCHEMA, validateSwapOperation } from "./model.js";
const ALLOWED = {
    quoted: ["prepared", "failed_before_effect"],
    prepared: ["awaiting_approval", "failed_before_effect"],
    awaiting_approval: ["reserved", "failed_before_effect"],
    reserved: ["submitting", "failed_before_effect"],
    submitting: ["submitted", "unknown_finality"],
    submitted: ["unknown_finality", "finalized"],
    unknown_finality: ["finalized"],
    finalized: [],
    failed_before_effect: [],
};
export function transitionSwapOperation(opValue, state, evidence, now) {
    const op = validateSwapOperation(opValue);
    if (!isPlainRecord(evidence) || !exactKeys(evidence, [
        ...(evidence.usageLease === undefined ? [] : ["usageLease"]),
        ...(evidence.submissionMarker === undefined ? [] : ["submissionMarker"]),
        ...(evidence.receiptProof === undefined ? [] : ["receiptProof"]),
        ...(evidence.failureProofHash === undefined ? [] : ["failureProofHash"]),
    ]))
        invalid("Swap transition evidence is invalid.");
    if (!ALLOWED[op.state].includes(state))
        blocked("Swap operation transition is invalid.");
    const at = instant(now);
    if (at < op.updatedAt)
        blocked("Swap operation transition cannot move backward in time.");
    const patch = transitionPatch(op, state, evidence, at);
    const { integrityHash: previousIntegrityHash, ...current } = op;
    const body = { ...current, ...patch, state, revision: op.revision + 1, updatedAt: at, previousIntegrityHash };
    return validateSwapOperation({ ...body, integrityHash: domainHash(SWAP_OPERATION_SCHEMA, canonicalJson(body)) });
}
function transitionPatch(op, state, evidence, at) {
    if (state === "prepared" || state === "awaiting_approval") {
        if (Object.keys(evidence).length !== 0)
            invalid("This swap transition accepts no additional evidence.");
        return {};
    }
    if (state === "reserved") {
        if (evidence.usageLease?.state !== "reserved" || Object.keys(evidence).length !== 1)
            invalid("Reserved swap requires its exact reserved usage lease.");
        return { usageLease: evidence.usageLease };
    }
    if (state === "submitting") {
        if (evidence.submissionMarker === undefined || Object.keys(evidence).length !== 1 || evidence.submissionMarker.markedAt !== at) {
            invalid("Submitting swap requires one freshly persisted submission marker.");
        }
        return { submissionMarker: evidence.submissionMarker };
    }
    if (state === "submitted" || state === "unknown_finality") {
        if (evidence.usageLease === undefined || Object.keys(evidence).some((key) => key !== "usageLease" && key !== "receiptProof") ||
            evidence.usageLease.state !== (state === "submitted" ? "submitted" : "unknown_finality")) {
            invalid("Post-send swap transition requires its matching charged usage lease.");
        }
        return { usageLease: evidence.usageLease, ...(evidence.receiptProof === undefined ? {} : { receiptProof: evidence.receiptProof }) };
    }
    if (state === "finalized") {
        if (evidence.usageLease?.state !== "finalized" || evidence.receiptProof?.finalized !== true || Object.keys(evidence).length !== 2) {
            invalid("Finalized swap requires a finalized usage lease and receipt proof.");
        }
        return { usageLease: evidence.usageLease, receiptProof: evidence.receiptProof };
    }
    if (state === "failed_before_effect") {
        if (evidence.failureProofHash === undefined || !/^[a-f0-9]{64}$/u.test(evidence.failureProofHash) ||
            (evidence.usageLease !== undefined && evidence.usageLease.state !== "failed_before_effect") ||
            Object.keys(evidence).some((key) => key !== "failureProofHash" && key !== "usageLease")) {
            invalid("Pre-effect failure requires bound proof and any lease must already be released.");
        }
        return { failureProofHash: evidence.failureProofHash, ...(evidence.usageLease === undefined ? {} : { usageLease: evidence.usageLease }) };
    }
    return invalid("Swap transition is unsupported.");
}
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    invalid("Swap transition time is invalid."); return value.toISOString(); }
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
//# sourceMappingURL=transitions.js.map