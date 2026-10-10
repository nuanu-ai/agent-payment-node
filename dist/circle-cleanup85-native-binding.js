import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { CLEANUP85_FEE_CAP, CLEANUP85_OWNER, CLEANUP85_RECIPIENT, CLEANUP85_RECIPIENT_CODE, CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH, cleanup85Blocked, validateCleanup85Request, validateCleanup85Envelope } from "./circle-cleanup85-native-codec.js";
import { validateEvmNativeCustody } from "./evm-native-custody.js";
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
//# sourceMappingURL=circle-cleanup85-native-binding.js.map