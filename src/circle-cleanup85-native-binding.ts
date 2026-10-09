import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import { CLEANUP85_FEE_CAP, CLEANUP85_OWNER, CLEANUP85_RECIPIENT, CLEANUP85_RECIPIENT_CODE, CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH, cleanup85Blocked, validateCleanup85Request, validateCleanup85Envelope } from "./circle-cleanup85-native-codec.js";
import { validateEvmNativeCustody, type EvmNativeCustody } from "./evm-native-custody.js";
import type { OperationRecord } from "./model.js";

export interface Cleanup85NativeBinding {
  readonly version: "apn.circle-cleanup85-native-binding.v1";
  readonly request: Cleanup85CancellationRequest;
  readonly recipientCustody: EvmNativeCustody;
  readonly activationDigest: string;
  readonly nativeReservationId: string;
  readonly nativeReserveAtomic: "2000000000000";
  readonly senderCode: "0x";
  readonly recipientCode: typeof CLEANUP85_RECIPIENT_CODE;
  readonly recipientDelegateCodeHash: typeof CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH;
}
export function validateCleanup85NativeBinding(value: unknown): Cleanup85NativeBinding {
  if (!isPlainRecord(value) || !exactKeys(value, ["version", "request", "recipientCustody", "activationDigest", "nativeReservationId", "nativeReserveAtomic","senderCode","recipientCode","recipientDelegateCodeHash"]) ||
    value.version !== "apn.circle-cleanup85-native-binding.v1" || value.nativeReserveAtomic !== "2000000000000" ||
    value.senderCode!=="0x"||value.recipientCode!==CLEANUP85_RECIPIENT_CODE||value.recipientDelegateCodeHash!==CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH||
    ![value.activationDigest, value.nativeReservationId].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x))) cleanup85Blocked("native_binding_shape");
  validateCleanup85Request(value.request);
  const custody = validateEvmNativeCustody(value.recipientCustody);
  if (custody.walletAddress !== CLEANUP85_RECIPIENT) cleanup85Blocked("recipient_custody");
  return value as unknown as Cleanup85NativeBinding;
}
export function cleanup85OperationEnvelope(o: OperationRecord) {
  const b = o.evm?.cleanup85Cancellation, e = o.economics;
  if (b === undefined || e === undefined || o.profile !== "evm-live-buyer" || o.walletAddress !== CLEANUP85_OWNER || o.chainId !== 42161 ||
    o.recipient !== CLEANUP85_RECIPIENT || o.amountAtomic !== "1" || o.token !== "0x0000000000000000000000000000000000000000" || o.transactionData !== "0x" ||
    o.evm?.asset.kind !== "native" || o.evm.circleNativeAdmission !== undefined || o.evm.maxFeeWei !== CLEANUP85_FEE_CAP.toString()) cleanup85Blocked("native_operation_binding");
  validateCleanup85NativeBinding(b);
  const body = { chainId: 42161 as const, from: CLEANUP85_OWNER, to: CLEANUP85_RECIPIENT, nonceAtomic: "85" as const,
    valueAtomic: "1" as const, data: "0x" as const, gasLimitAtomic: e.gasLimitAtomic, maxFeePerGasAtomic: e.maxFeePerGasAtomic, maxPriorityFeePerGasAtomic: e.maxPriorityFeePerGasAtomic };
  if (e.nonceAtomic !== "85") cleanup85Blocked("native_operation_nonce");
  return validateCleanup85Envelope({ ...body, envelopeHash: hashObject(body) });
}
