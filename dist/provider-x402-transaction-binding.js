import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
export function recoveryMaterialDigest(input) {
    return hashObject({
        schemaVersion: "apn.provider-x402.recovery-material.v1",
        chainId: "8453",
        evidenceMode: "exact_transaction",
        ...input,
    });
}
export function sealTransactionReservation(value) {
    return { ...value, integrityHash: hashObject(value) };
}
export function validateTransactionReservation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "chainId", "transactionHash", "operationId", "profileHash", "evidenceMode",
        "idempotencyDigest", "materialDigest", "createdAt", "integrityHash",
    ]))
        corrupt();
    const reservation = value;
    const { integrityHash: _integrityHash, ...base } = reservation;
    if (reservation.schemaVersion !== "apn.provider-x402.transaction-reservation.v1" ||
        reservation.chainId !== "8453" || reservation.evidenceMode !== "exact_transaction" ||
        !transactionHash(reservation.transactionHash) || !hash(reservation.operationId) ||
        !hash(reservation.profileHash) || !hash(reservation.idempotencyDigest) || !hash(reservation.materialDigest) ||
        reservation.materialDigest !== recoveryMaterialDigest({
            operationId: reservation.operationId,
            transactionHash: reservation.transactionHash,
            idempotencyDigest: reservation.idempotencyDigest,
        }) ||
        !canonicalUtc(reservation.createdAt) || reservation.integrityHash !== hashObject(base))
        corrupt();
    return reservation;
}
export function sameReservation(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}
export function sealTransactionReservationIndex(reservations) {
    const value = {
        schemaVersion: "apn.provider-x402.transaction-reservation-index.v1",
        reservations: [...reservations].sort((left, right) => left.transactionHash.localeCompare(right.transactionHash)),
    };
    return { ...value, integrityHash: hashObject(value) };
}
export function validateTransactionReservationIndex(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "reservations", "integrityHash"]) ||
        value.schemaVersion !== "apn.provider-x402.transaction-reservation-index.v1" || !Array.isArray(value.reservations))
        corrupt();
    const index = value;
    const reservations = index.reservations.map(validateTransactionReservation);
    const canonical = sealTransactionReservationIndex(reservations);
    if (canonicalJson(canonical) !== canonicalJson(index))
        corrupt();
    const transactions = new Set();
    const idempotency = new Set();
    for (const reservation of reservations) {
        if (transactions.has(reservation.transactionHash) || idempotency.has(reservation.idempotencyDigest))
            corrupt();
        transactions.add(reservation.transactionHash);
        idempotency.add(reservation.idempotencyDigest);
    }
    return index;
}
function transactionHash(value) {
    return typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value) && !/^0x0{64}$/u.test(value);
}
function hash(value) { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function canonicalUtc(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function corrupt() {
    throw new ApnError("APN_STATE_CORRUPT", "Provider x402 transaction reservation validation failed.");
}
//# sourceMappingURL=provider-x402-transaction-binding.js.map