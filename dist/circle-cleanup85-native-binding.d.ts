import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import { CLEANUP85_RECIPIENT_CODE, CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH } from "./circle-cleanup85-native-codec.js";
import { type EvmNativeCustody } from "./evm-native-custody.js";
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
export declare function validateCleanup85NativeBinding(value: unknown): Cleanup85NativeBinding;
export declare function cleanup85OperationEnvelope(o: OperationRecord): import("./circle-cleanup85-cancellation-contract.js").Cleanup85CancellationEnvelope;
