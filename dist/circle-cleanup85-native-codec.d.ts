import { type Hex } from "viem";
import type { Cleanup85CancellationEnvelope, Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import type { CircleObservation } from "./circle-v2-evm/protocol.js";
export declare const CLEANUP85_OWNER = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
export declare const CLEANUP85_RECIPIENT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
export declare const CLEANUP85_RECIPIENT_DELEGATE = "0xe6cae83bde06e4c305530e199d7217f42808555b";
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
export declare function cleanup85Envelope(gas: string, currentMaxFee: string, currentPriority: string): Cleanup85CancellationEnvelope;
export declare function validateCleanup85Envelope(value: unknown): Cleanup85CancellationEnvelope;
/** Strict actual native wire codec. A Circle value-zero codec cannot prove this value-one transfer. */
export declare function verifyCleanup85Raw(e: Cleanup85CancellationEnvelope, raw: Hex): Promise<Hex>;
/** Pure cryptographic comparator; it grants no policy, custody, nonce or dispatch authority.
 * The finite production wrapper above always validates the immutable actual-owner pins first. */
export declare function verifyNativeCancellationRawFields(e: {
    readonly chainId: number;
    readonly from: string;
    readonly to: string;
    readonly nonceAtomic: string;
    readonly valueAtomic: string;
    readonly data: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
}, raw: Hex): Promise<Hex>;
/** RPC transaction signature values are QUANTITYs. Accept fixed-width DATA only for providers retaining the legacy word form. */
export declare function evmRpcSignatureScalar(value: unknown): Hex;
export interface Cleanup85NativeReceipt {
    readonly transactionHash: Hex;
    readonly blockHash: Hex;
    readonly blockNumberAtomic: string;
    readonly receiptHash: string;
    readonly actualFeeAtomic: string;
    readonly nativeConsumedAtomic: string;
}
/** Finalized evidence must contain the exact signed transaction once, at its exact receipt index. */
export declare function verifyCleanup85Observation(e: Cleanup85CancellationEnvelope, expectedHash: Hex, input: CircleObservation): Promise<Cleanup85NativeReceipt>;
