import { type CircleEnvelope, type CircleOperationV1 } from "../circle-v2-evm/operation-model.js";
import type { CircleReceiptProof } from "../circle-v2-evm/protocol.js";
import type { CircleNonceRetirementProof } from "../circle-v2-evm/nonce-retirement-proof.js";
import { type ConsumedBurnEvidence } from "./circle-sealed-burn-retirement.js";
import type { Cleanup85CancellationProof } from "./cleanup85-native-records.js";
export declare const CLEANUP85_HASH = "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95";
export declare const CLEANUP85_MATERIAL = "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
export declare const CLEANUP85_ENVELOPE = "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583";
export declare function assertCleanup85Parent(op: CircleOperationV1, observedOriginal?: boolean): void;
export interface Cleanup85RecoveryProof extends ConsumedBurnEvidence {
    readonly version: "apn.circle-cleanup85-recovery-proof.v1";
    readonly mode: "observed_original" | "cancelled_then_cleanup86";
    readonly parentIntentHash: string;
    readonly recoveryBinding: string | null;
    readonly oldCleanupTransactionHash: typeof CLEANUP85_HASH;
    readonly oldCleanupMaterialHash: typeof CLEANUP85_MATERIAL;
    readonly oldCleanupEnvelopeHash: typeof CLEANUP85_ENVELOPE;
    readonly cleanupEnvelope: CircleEnvelope;
    readonly cleanupMaterialHash: string;
    readonly cleanupIntentHash: string | null;
    readonly cleanupProof: CircleReceiptProof;
    readonly cancellation: Cleanup85CancellationProof | null;
}
export declare function validateCleanup85RecoveryProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void;
export declare function assertCancellationProofShape(proof: Cleanup85CancellationProof): void;
