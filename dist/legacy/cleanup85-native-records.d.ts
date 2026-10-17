import { type EvmNativeCustody } from "../evm-native-custody.js";
import type { OperationRecord } from "../model.js";
import type { CircleObservation } from "../circle-v2-evm/protocol.js";
/**
 * Frozen, read-only codecs for the records of the owner's historical cleanup85 native cancellation (Circle operation
 * 4ee24e45..., terminal `nonce_retired` since 0.5.43): the 1-wei Arbitrum native cancellation at nonce 85 (a direct operation, binding
 * `evm.cleanup85Cancellation`), its envelope, and the cleanup85 native hold marker and actual settlement in the shared
 * usage ledger. The executing controller that wrote them is deleted; these validators only let status, receipts and
 * the ledger keep loading what earlier releases wrote. Nothing here signs, sends, reads RPC or writes state, and no live
 * write path may call into this module except to load or refuse such a record.
 */
/** The stored request that bound the native cancellation to its Circle parent (never dispatch authority). */
export interface Cleanup85CancellationRequest {
    readonly parentOperationId: "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
    readonly recoveryBinding: string;
    readonly parentIntentHash: string;
    readonly oldCleanupTransactionHash: "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95";
    readonly oldCleanupMaterialHash: "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
    readonly oldCleanupEnvelopeHash: "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583";
}
export interface Cleanup85CancellationEnvelope {
    readonly chainId: 42161;
    readonly from: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
    readonly to: "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
    readonly nonceAtomic: "85";
    readonly valueAtomic: "1";
    readonly data: "0x";
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly envelopeHash: string;
}
/** Public finalized evidence of the native cancellation, embedded in the parent's terminal retirement proof. */
export interface Cleanup85CancellationProof {
    readonly version: "apn.circle-cleanup85-native-cancellation-proof.v1";
    readonly requestBinding: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly materialHash: string;
    readonly transactionHash: string;
    readonly envelope: Cleanup85CancellationEnvelope;
    readonly sourceCustody: EvmNativeCustody;
    readonly recipientCustody: EvmNativeCustody;
    readonly observation: CircleObservation;
    readonly actualFeeAtomic: string;
    readonly nativeReservationId: string;
    readonly nativeOutcomeDigest: string;
    readonly nativeConsumedAtomic: string;
    readonly proofHash: string;
}
export declare const CLEANUP85_OWNER = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
export declare const CLEANUP85_RECIPIENT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
export declare const CLEANUP85_RECIPIENT_CODE = "0xef0100e6cae83bde06e4c305530e199d7217f42808555b";
export declare const CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH = "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3";
export declare const CLEANUP85_FEE_CAP = 2000000000000n;
export declare const CLEANUP85_REQUEST: Readonly<{
    parentOperationId: "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
    oldCleanupTransactionHash: "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95";
    oldCleanupMaterialHash: "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
    oldCleanupEnvelopeHash: "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583";
}>;
export declare function cleanup85Blocked(reason: string): never;
export declare function validateCleanup85Request(value: unknown): Cleanup85CancellationRequest;
export declare function validateCleanup85Envelope(value: unknown): Cleanup85CancellationEnvelope;
export interface Cleanup85NativeBinding {
    readonly version: "apn.circle-cleanup85-native-binding.v1" | "apn.circle-cleanup85-native-binding.v2";
    readonly successor?: {
        readonly originalOperationId: string;
        readonly retirementProofHash: string;
    };
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
export declare function cleanup85OperationEnvelope(o: OperationRecord): Cleanup85CancellationEnvelope;
export interface Cleanup85NativeActualSettlement {
    readonly kind: "circle_cleanup85_native_actual";
    readonly operationId: string;
    readonly fingerprint: string;
    readonly requestBinding: string;
    readonly transactionHash: string;
    readonly receiptHash: string;
    readonly blockHash: string;
    readonly blockNumberAtomic: string;
    readonly actualFeeAtomic: string;
    readonly nativeConsumedAtomic: string;
    readonly reservedAtomic: "2000000000000";
    readonly nativeReservationId: string;
    readonly policyDigest: string;
    readonly outcomeDigest: string;
}
export interface Cleanup85NativeReservationMarker {
    readonly version: "apn.cleanup85-native-reservation.v1";
    readonly operationId: string;
    readonly fingerprint: string;
    readonly requestBinding: string;
    readonly envelopeHash: string;
    readonly signedMaximumDebitAtomic: string;
    readonly reservedAtomic: "2000000000000";
    readonly policyDigest: string;
    readonly activationDigest: string;
}
/** A stored cleanup85 native hold row, checked against its own marker, actual settlement and digest. */
export declare function validateCleanup85NativeUsage(value: Record<string, unknown>): void;
