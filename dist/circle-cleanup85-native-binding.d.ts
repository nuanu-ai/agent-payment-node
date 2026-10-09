import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import { type EvmNativeCustody } from "./evm-native-custody.js";
import type { OperationRecord } from "./model.js";
export interface Cleanup85NativeBinding {
    readonly version: "apn.circle-cleanup85-native-binding.v1";
    readonly request: Cleanup85CancellationRequest;
    readonly recipientCustody: EvmNativeCustody;
    readonly activationDigest: string;
    readonly nativeReservationId: string;
    readonly nativeReserveAtomic: "2000000000000";
}
export declare function validateCleanup85NativeBinding(value: unknown): Cleanup85NativeBinding;
export declare function cleanup85OperationEnvelope(o: OperationRecord): import("./circle-cleanup85-cancellation-contract.js").Cleanup85CancellationEnvelope;
