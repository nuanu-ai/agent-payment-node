import type { Cleanup85CancellationProof } from "../circle-cleanup85-cancellation-contract.js";
import { type ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { CLEANUP85_HASH, CLEANUP85_MATERIAL, CLEANUP85_ENVELOPE } from "./cleanup85-recovery-store.js";
import { type CircleEnvelope, type CircleOperationV1 } from "./operation-model.js";
import type { CircleReceiptProof } from "./protocol.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
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
