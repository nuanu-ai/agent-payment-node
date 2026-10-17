import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateEvmNativeCustody } from "../evm-native-custody.js";
import { assetUsageReservationId, atomic as usageAtomic, corrupt, idempotency } from "../asset-usage-ledger-record.js";
export const CLEANUP85_OWNER = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
export const CLEANUP85_RECIPIENT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
export const CLEANUP85_RECIPIENT_CODE = "0xef0100e6cae83bde06e4c305530e199d7217f42808555b";
export const CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH = "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3";
export const CLEANUP85_FEE_CAP = 2000000000000n;
export const CLEANUP85_REQUEST = Object.freeze({
    parentOperationId: "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33",
    oldCleanupTransactionHash: "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95",
    oldCleanupMaterialHash: "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468",
    oldCleanupEnvelopeHash: "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583",
});
export function cleanup85Blocked(reason) {
    throw new ApnError("APN_OPERATION_BLOCKED", `Finite cleanup85 cancellation refused: ${reason}.`, { reason: `cleanup85_${reason}` });
}
export function validateCleanup85Request(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [...Object.keys(CLEANUP85_REQUEST), "recoveryBinding", "parentIntentHash"]) ||
        Object.entries(CLEANUP85_REQUEST).some(([key, expected]) => value[key] !== expected) ||
        ![value.recoveryBinding, value.parentIntentHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)))
        cleanup85Blocked("request_binding");
    return Object.freeze({ ...value });
}
const atomic = (value) => {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value))
        cleanup85Blocked("envelope_quantity");
    return BigInt(value);
};
const bump = (n) => (n * 9n + 7n) / 8n;
export function validateCleanup85Envelope(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["chainId", "from", "to", "nonceAtomic", "valueAtomic", "data", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "envelopeHash"]))
        cleanup85Blocked("envelope_shape");
    const e = value, { envelopeHash, ...body } = e;
    if (e.chainId !== 42161 || e.from !== CLEANUP85_OWNER || e.to !== CLEANUP85_RECIPIENT || e.nonceAtomic !== "85" || e.valueAtomic !== "1" || e.data !== "0x" ||
        envelopeHash !== hashObject(body) || atomic(e.gasLimitAtomic) < 21000n || atomic(e.maxFeePerGasAtomic) < bump(40000000n) ||
        atomic(e.maxPriorityFeePerGasAtomic) < 1n || atomic(e.maxPriorityFeePerGasAtomic) > atomic(e.maxFeePerGasAtomic) ||
        atomic(e.gasLimitAtomic) * atomic(e.maxFeePerGasAtomic) + 1n > CLEANUP85_FEE_CAP)
        cleanup85Blocked("envelope_binding_or_cap");
    return e;
}
export function validateCleanup85NativeBinding(value) {
    const successor = isPlainRecord(value) && value.version === "apn.circle-cleanup85-native-binding.v2";
    if (!isPlainRecord(value) || !exactKeys(value, ["version", "request", "recipientCustody", "activationDigest", "nativeReservationId", "nativeReserveAtomic", "senderCode", "recipientCode", "recipientDelegateCodeHash", ...(successor ? ["successor"] : [])]) ||
        !["apn.circle-cleanup85-native-binding.v1", "apn.circle-cleanup85-native-binding.v2"].includes(value.version) || value.nativeReserveAtomic !== "2000000000000" ||
        value.senderCode !== "0x" || value.recipientCode !== CLEANUP85_RECIPIENT_CODE || value.recipientDelegateCodeHash !== CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH ||
        ![value.activationDigest, value.nativeReservationId].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)))
        cleanup85Blocked("native_binding_shape");
    if (successor && (!isPlainRecord(value.successor) || !exactKeys(value.successor, ["originalOperationId", "retirementProofHash"]) || ![value.successor.originalOperationId, value.successor.retirementProofHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x))))
        cleanup85Blocked("native_successor_binding");
    validateCleanup85Request(value.request);
    const custody = validateEvmNativeCustody(value.recipientCustody);
    if (custody.walletAddress !== CLEANUP85_RECIPIENT)
        cleanup85Blocked("recipient_custody");
    return value;
}
export function cleanup85OperationEnvelope(o) {
    const b = o.evm?.cleanup85Cancellation, e = o.economics;
    if (b === undefined || e === undefined || o.profile !== "evm-live-buyer" || o.walletAddress !== CLEANUP85_OWNER || o.chainId !== 42161 ||
        o.recipient !== CLEANUP85_RECIPIENT || o.amountAtomic !== "1" || o.token !== "0x0000000000000000000000000000000000000000" || o.transactionData !== "0x" ||
        o.evm?.asset.kind !== "native" || o.evm.circleNativeAdmission !== undefined || o.evm.maxFeeWei !== CLEANUP85_FEE_CAP.toString())
        cleanup85Blocked("native_operation_binding");
    validateCleanup85NativeBinding(b);
    const body = { chainId: 42161, from: CLEANUP85_OWNER, to: CLEANUP85_RECIPIENT, nonceAtomic: "85",
        valueAtomic: "1", data: "0x", gasLimitAtomic: e.gasLimitAtomic, maxFeePerGasAtomic: e.maxFeePerGasAtomic, maxPriorityFeePerGasAtomic: e.maxPriorityFeePerGasAtomic };
    if (e.nonceAtomic !== "85")
        cleanup85Blocked("native_operation_nonce");
    return validateCleanup85Envelope({ ...body, envelopeHash: hashObject(body) });
}
/** A stored cleanup85 native hold row, checked against its own marker, actual settlement and digest. */
export function validateCleanup85NativeUsage(value) {
    const m = value.cleanup85NativeReservation, p = value.cleanup85NativeActual;
    if (!isPlainRecord(m) || !exactKeys(m, ["version", "operationId", "fingerprint", "requestBinding", "envelopeHash", "signedMaximumDebitAtomic", "reservedAtomic", "policyDigest", "activationDigest"]) || m.version !== "apn.cleanup85-native-reservation.v1" || m.reservedAtomic !== "2000000000000" || value.account !== "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7" || value.chain !== "eip155:42161" || value.rail !== "direct" || !isPlainRecord(value.asset) || value.asset.kind !== "native" || value.asset.identifier !== null || value.amountAtomic !== m.reservedAtomic || value.policyDigest !== m.policyDigest)
        corrupt("Cleanup85 native reservation projection is invalid.");
    if (![m.operationId, m.fingerprint, m.requestBinding, m.envelopeHash, m.policyDigest, m.activationDigest].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) || usageAtomic(m.signedMaximumDebitAtomic, true, true) > 2000000000000n)
        corrupt("Cleanup85 native reservation identity or signed maximum is invalid.");
    const key = `apn.cleanup85-native:${m.operationId}`;
    if (value.idempotencyHash !== idempotency(key) || value.reservationId !== assetUsageReservationId(value, key) || value.state === "failed_confirmed_revert")
        corrupt("Cleanup85 native reservation binding is invalid.");
    if (p === undefined) {
        if (!["reserved", "submitted", "unknown_finality"].includes(value.state) || value.consumedAtomic !== undefined)
            corrupt("Cleanup85 native settlement proof is required.");
        return;
    }
    if (!isPlainRecord(p) || !exactKeys(p, ["kind", "operationId", "fingerprint", "requestBinding", "transactionHash", "receiptHash", "blockHash", "blockNumberAtomic", "actualFeeAtomic", "nativeConsumedAtomic", "reservedAtomic", "nativeReservationId", "policyDigest", "outcomeDigest"]) || p.kind !== "circle_cleanup85_native_actual" || value.state !== "finalized" || p.operationId !== m.operationId || p.fingerprint !== m.fingerprint || p.requestBinding !== m.requestBinding || p.policyDigest !== m.policyDigest || p.reservedAtomic !== m.reservedAtomic)
        corrupt("Cleanup85 native actual debit projection is invalid.");
    if (![p.operationId, p.fingerprint, p.requestBinding, p.receiptHash, p.nativeReservationId, p.policyDigest, p.outcomeDigest].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) || ![p.transactionHash, p.blockHash].every(x => typeof x === "string" && /^0x[a-f0-9]{64}$/u.test(x)))
        corrupt("Cleanup85 native actual debit identity is invalid.");
    const { outcomeDigest, ...body } = p;
    if (value.reservationId !== p.nativeReservationId || value.outcomeDigest !== outcomeDigest || hashObject(body) !== outcomeDigest || value.consumedAtomic !== p.nativeConsumedAtomic || usageAtomic(p.nativeConsumedAtomic, true, true) !== usageAtomic(p.actualFeeAtomic, false, true) + 1n || usageAtomic(p.nativeConsumedAtomic, true, true) > usageAtomic(m.signedMaximumDebitAtomic, true, true) || usageAtomic(p.blockNumberAtomic, true, true) === 0n)
        corrupt("Cleanup85 native actual debit conservation or binding is invalid.");
}
//# sourceMappingURL=cleanup85-native-records.js.map