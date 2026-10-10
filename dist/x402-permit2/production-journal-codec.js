import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { decodePermit2PaymentSignatureHeader } from "../x402-codec.js";
import { ApnError } from "../errors.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
export const JOURNAL_SCHEMA = "apn.x402-permit2-production.exposure.v1";
const HASH = /^[a-f0-9]{64}$/u, HEX_HASH = /^0x[a-f0-9]{64}$/u;
/** Binding only: no human approval or custody permission. */
export function productionApprovalFingerprint(record) {
    const p = reconstructPermit2ProductionMaterial(record.material);
    return domainHash(`${JOURNAL_SCHEMA}.approval`, canonicalJson({ operationId: record.operationId,
        materialHash: record.material.materialHash, wallet: record.material.wallet, owner: record.material.owner,
        checkpoint: record.material.checkpoint, requestHash: record.material.checked.requestHash,
        challengeHash: record.material.checked.challengeHash, permit2Deadline: p.plan.authorization.deadline,
        eip2612Deadline: p.plan.eip2612?.info.deadline ?? null }));
}
export function productionRiskBinding(record) {
    return domainHash(`${JOURNAL_SCHEMA}.risk`, canonicalJson({ operationId: record.operationId,
        materialHash: record.material.materialHash, requestHash: record.requestHash, approvalFingerprint: productionApprovalFingerprint(record) }));
}
export function productionTerminalDigest(record, intent) {
    const p = reconstructPermit2ProductionMaterial(record.material);
    return domainHash(`${JOURNAL_SCHEMA}.terminal`, canonicalJson({ operationId: record.operationId,
        materialHash: record.material.materialHash, riskBinding: productionRiskBinding(record), outcome: intent.outcome,
        operationDigest: intent.operationDigest, requestHash: intent.requestHash, challengeHash: intent.challengeHash,
        signedHash: intent.signedHash, ...(intent.outcome === "settled" ? {
            transactionHash: intent.transactionHash, blockNumber: intent.blockNumber, blockHash: intent.blockHash,
        } : { nonce: record.material.nonce, word: (BigInt(record.material.nonce) >> 8n).toString(),
            bit: (BigInt(record.material.nonce) & 255n).toString(), tokenNonce: p.plan.eip2612?.info.nonce ?? null,
            tokenDomain: p.plan.selection.listAsset.tokenDomainSeparator, permit2Deadline: p.plan.authorization.deadline,
            eip2612Deadline: p.plan.eip2612?.info.deadline ?? null }) }));
}
export function productionStableDigest(record) {
    return domainHash("apn.x402-permit2-production.signed.v1.operation", canonicalJson({ operationId: record.operationId,
        profileHash: record.profileHash, idempotencyHash: record.idempotencyHash, requestHash: record.requestHash,
        materialHash: record.material.materialHash, createdAt: record.createdAt }));
}
export function validateExposureJournal(value, record) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "approvalFingerprint", "bindingHash", "permit2Deadline",
        "eip2612Deadline", "holdConfirmed", "signed", "request", "terminalIntent"]))
        corrupt();
    const j = value, p = reconstructPermit2ProductionMaterial(record.material);
    if (j.schemaVersion !== JOURNAL_SCHEMA || j.approvalFingerprint !== productionApprovalFingerprint(record) ||
        j.bindingHash !== productionRiskBinding(record) || j.permit2Deadline !== p.plan.authorization.deadline ||
        j.eip2612Deadline !== (p.plan.eip2612?.info.deadline ?? null) || typeof j.holdConfirmed !== "boolean")
        corrupt();
    if (j.signed !== null) {
        const s = j.signed;
        if (!isPlainRecord(s) || !exactKeys(s, ["schemaVersion", "operationDigest", "permit2Signature", "eip2612Signature",
            "paymentSignatureHeader", "headerHash", "signedHash"]) || s.schemaVersion !== "apn.x402-permit2-production.signed.v1" ||
            s.operationDigest !== productionStableDigest(record) || typeof s.paymentSignatureHeader !== "string" ||
            s.headerHash !== sha256(s.paymentSignatureHeader) || !HASH.test(s.signedHash))
            corrupt();
        const decoded = decodePermit2PaymentSignatureHeader(s.paymentSignatureHeader);
        const extension = decoded.extensions?.eip2612GasSponsoring;
        const eipSignature = isPlainRecord(extension) && isPlainRecord(extension.info) ? extension.info.signature : null;
        if (s.permit2Signature !== decoded.payload.signature || s.eip2612Signature !== eipSignature)
            corrupt();
        const { signedHash, ...body } = s;
        if (signedHash !== domainHash(s.schemaVersion, canonicalJson(body)) || !j.holdConfirmed)
            corrupt();
    }
    if (j.request !== null && (!isPlainRecord(j.request) || !exactKeys(j.request, ["attempt", "requestHash", "headerHash"]) ||
        j.request.attempt !== 1 || j.request.requestHash !== record.material.checked.requestHash ||
        j.signed === null || j.request.headerHash !== j.signed.headerHash || !j.holdConfirmed))
        corrupt();
    if (j.terminalIntent !== null) {
        const i = j.terminalIntent;
        if (!isPlainRecord(i) || !exactKeys(i, ["outcome", "operationDigest", "materialHash", "requestHash", "challengeHash",
            "signedHash", "transactionHash", "blockNumber", "blockHash", "observation", "outcomeDigest"]) ||
            !["settled", "expired_unused"].includes(i.outcome) || i.operationDigest !== productionStableDigest(record) ||
            i.materialHash !== record.material.materialHash || i.requestHash !== record.material.checked.requestHash ||
            i.challengeHash !== record.material.checked.challengeHash || i.signedHash !== (j.signed?.signedHash ?? null) ||
            !/^(?:0|[1-9][0-9]*)$/u.test(i.blockNumber) || !HEX_HASH.test(i.blockHash) ||
            (i.outcome === "settled" ? j.signed === null || !HEX_HASH.test(i.transactionHash ?? "") : i.transactionHash !== null) || !j.holdConfirmed)
            corrupt();
        validateRetainedObservation(i.observation, i);
        const { outcomeDigest, ...body } = i;
        if (outcomeDigest !== productionTerminalDigest(record, body))
            corrupt();
    }
    return j;
}
function validateRetainedObservation(value, i) {
    if (!isPlainRecord(value) || !exactKeys(value, ["mode", "outcome", "reason", "operationDigest", "materialHash", "requestHash",
        "challengeHash", "signedHash", "transactionHash", "blockNumber", "blockHash", "tokenPermitOutcome", "rpc"]) ||
        value.mode !== (i.outcome === "settled" ? "settlement" : "expired_unused") || value.reason !== "checked" || value.outcome !== i.outcome ||
        ![null, "not_requested", "not_proven"].includes(value.tokenPermitOutcome) ||
        !isPlainRecord(value.rpc) || !exactKeys(value.rpc, ["attempts", "admissions", "physicalDispatches", "logicalReads", "errors", "methods"]) ||
        !isPlainRecord(value.rpc.methods))
        corrupt();
    for (const key of ["operationDigest", "materialHash", "requestHash", "challengeHash", "signedHash", "transactionHash", "blockNumber", "blockHash"])
        if (value[key] !== i[key])
            corrupt();
    for (const count of [value.rpc.attempts, value.rpc.admissions, value.rpc.physicalDispatches, value.rpc.logicalReads, value.rpc.errors, ...Object.values(value.rpc.methods)])
        if (!Number.isSafeInteger(count) || Number(count) < 0)
            corrupt();
    if (Object.keys(value.rpc.methods).some(method => !["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionByHash",
        "eth_getTransactionReceipt", "eth_getCode", "eth_call"].includes(method)))
        corrupt();
}
/** Append-only risk, bearer, attempt and first terminal intent. */
export function assertExposureAppend(current, next) {
    if (current === undefined)
        return;
    for (const key of ["schemaVersion", "approvalFingerprint", "bindingHash", "permit2Deadline", "eip2612Deadline"])
        if (current[key] !== next[key])
            corrupt();
    if (current.holdConfirmed && !next.holdConfirmed)
        corrupt();
    for (const key of ["signed", "request", "terminalIntent"])
        if (current[key] !== null && canonicalJson(current[key]) !== canonicalJson(next[key]))
            corrupt();
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Permit2 exposure journal is corrupt."); }
//# sourceMappingURL=production-journal-codec.js.map