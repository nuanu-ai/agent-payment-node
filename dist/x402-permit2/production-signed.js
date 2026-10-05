import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { encodePermit2PaymentSignatureHeader, decodePermit2PaymentSignatureHeader } from "../x402-codec.js";
import { verifyPermit2PayerSignature } from "./authorization.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { validatePermit2ProductionRecord } from "./production-repository.js";
const SCHEMA = "apn.x402-permit2-production.signed.v1";
/** Stable across lease/effect state changes; binds the entire checked private request via materialHash. */
export function permit2ProductionOperationDigest(record) {
    validatePermit2ProductionRecord(record);
    return domainHash(`${SCHEMA}.operation`, canonicalJson({ operationId: record.operationId, profileHash: record.profileHash,
        idempotencyHash: record.idempotencyHash, requestHash: record.requestHash, materialHash: record.material.materialHash,
        createdAt: record.createdAt }));
}
/** Assembles supplied signatures only. Does not sign, reserve, persist or send. */
export async function createPermit2ProductionSigned(record, permit2Signature, eip2612Signature, nowSeconds) {
    record = validatePermit2ProductionRecord(JSON.parse(canonicalJson(record)));
    const prepared = reconstructPermit2ProductionMaterial(record.material);
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < record.material.signingSecond ||
        BigInt(nowSeconds) >= BigInt(prepared.expiresAtUnix))
        refuse();
    const payload = await wire(record, permit2Signature, eip2612Signature);
    const paymentSignatureHeader = encodePermit2PaymentSignatureHeader(payload);
    const body = { schemaVersion: SCHEMA, operationDigest: permit2ProductionOperationDigest(record), permit2Signature,
        eip2612Signature, paymentSignatureHeader, headerHash: sha256(paymentSignatureHeader) };
    return validatePermit2ProductionSigned({ ...body, signedHash: domainHash(SCHEMA, canonicalJson(body)) }, record);
}
/** Validation remains usable after expiry for observation. It grants no execution admission or chain-wallet proof. */
export async function validatePermit2ProductionSigned(value, record) {
    record = validatePermit2ProductionRecord(JSON.parse(canonicalJson(record)));
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationDigest", "permit2Signature", "eip2612Signature",
        "paymentSignatureHeader", "headerHash", "signedHash"]))
        refuse();
    const signed = Object.freeze({ ...value });
    const { signedHash, ...body } = signed;
    if (signed.schemaVersion !== SCHEMA || signed.operationDigest !== permit2ProductionOperationDigest(record) ||
        !/^[a-f0-9]{64}$/u.test(signedHash) || signedHash !== domainHash(SCHEMA, canonicalJson(body)) ||
        typeof signed.paymentSignatureHeader !== "string" || signed.headerHash !== sha256(signed.paymentSignatureHeader))
        refuse();
    const payload = await wire(record, signed.permit2Signature, signed.eip2612Signature);
    if (encodePermit2PaymentSignatureHeader(payload) !== signed.paymentSignatureHeader ||
        canonicalJson(decodePermit2PaymentSignatureHeader(signed.paymentSignatureHeader)) !== canonicalJson(payload))
        refuse();
    return Object.freeze({ ...signed });
}
async function wire(record, permit2Signature, eip2612Signature) {
    validatePermit2ProductionRecord(record);
    const prepared = reconstructPermit2ProductionMaterial(record.material), plan = prepared.plan;
    const payload = { x402Version: 2, resource: record.material.checked.challenge.resource,
        accepted: plan.selection.requirement,
        payload: { signature: permit2Signature, permit2Authorization: plan.authorization },
        ...(plan.eip2612 === null ? {} : { extensions: { eip2612GasSponsoring: {
                    info: { ...plan.eip2612.info, signature: eip2612Signature },
                } } }) };
    if ((plan.eip2612 === null) !== (eip2612Signature === null))
        refuse();
    // The dedicated codec checks canonical low-s 65-byte signatures, exact numeric/address shape and sponsoring fields.
    encodePermit2PaymentSignatureHeader(payload);
    await verifyPermit2PayerSignature(plan.permit2, permit2Signature, prepared.payer);
    if (plan.eip2612 !== null)
        await verifyPermit2PayerSignature(plan.eip2612.typedData, eip2612Signature, prepared.payer);
    return payload;
}
export async function publicPermit2ProductionSigned(value, record) {
    const signed = await validatePermit2ProductionSigned(value, record);
    return { operationDigest: signed.operationDigest, headerHash: signed.headerHash, signedHash: signed.signedHash };
}
function refuse() { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 production signed material does not match its frozen operation."); }
//# sourceMappingURL=production-signed.js.map