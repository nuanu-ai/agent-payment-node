import type { Hex } from "viem";
import { type CircleEnvelope, type CircleOperationV1 } from "../circle-v2-evm/operation-model.js";
import type { CircleReceiptProof } from "../circle-v2-evm/protocol.js";
import type { CircleNonceRetirementProof } from "../circle-v2-evm/nonce-retirement-proof.js";
/**
 * Frozen, read-only validators for the nonce-retirement records of the owner's historical Sei operation
 * 4ee24e45... (burn84 sealed and never sent, retired through the sealed-burn and consumed-burn variants; terminal
 * `nonce_retired` since 0.5.43). The executing recovery code that wrote these intents and proofs is deleted; the v1
 * journal validator and the retirement sidecar store call these only to load what earlier releases wrote. Pure functions:
 * no RPC, no signing, no state writes.
 */
/** One retained Sei operation only; this does not admit new routes or nonce retries. */
export declare const SEALED_BURN_OPERATION = "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
export declare const SEALED_BURN_HASH = "0x8d3f33d87653d0413aab7faee5b7884f0fc42a5e1dc7d08ba5cb75c72cc3d541";
export declare const SEALED_BURN_MATERIAL = "88158eafdfa699730e0d5e800ab974d7fad9a87db88772ce67591cceca7f165a";
export declare function isSealedBurnRetirement(op: CircleOperationV1): boolean;
export declare function assertSealedBurnRetirement(op: CircleOperationV1): void;
export declare function assertConsumedBurnIdentity(op: CircleOperationV1): void;
export declare function isConsumedBurnRetirement(op: CircleOperationV1): boolean;
export declare function assertSealedBurnReplacement(op: CircleOperationV1, e: CircleEnvelope): void;
export interface SealedBurnEvidence {
    readonly approvalProof: CircleReceiptProof;
    readonly usdcBalanceAtomic: string;
}
export declare function approvalReceiptIdentity(proof: CircleReceiptProof): string;
export interface SealedBurnRetirementProof extends SealedBurnEvidence {
    readonly version: "apn.circle-sealed-burn-retirement-proof.v1";
    readonly originalBurnHash: string;
    readonly originalBurnMaterialHash: string;
}
export declare function assertSealedBurnEvidence(e: SealedBurnEvidence, op: CircleOperationV1): void;
export declare function validateSealedBurnProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void;
export declare const CONSUMER_HASH: Hex;
export declare const CONSUMER_BLOCK_HASH = "0xb61353469b1f3f5459c48755db96a0a38d451654449507afd9a8ba097b65681d";
export interface ConsumedBurnEvidence {
    readonly approvalProof: CircleReceiptProof;
    readonly consumerProof: CircleReceiptProof;
    readonly usdcBalanceAtomic: string;
}
export declare function assertConsumedBurnEvidence(value: ConsumedBurnEvidence, op: CircleOperationV1): void;
export interface ConsumedBurnRetirementProof extends ConsumedBurnEvidence {
    readonly version: "apn.circle-consumed-burn-retirement-proof.v1";
    readonly originalBurnHash: string;
    readonly originalBurnMaterialHash: string;
}
export declare function assertConsumedCleanup(op: CircleOperationV1, e: CircleEnvelope): void;
export declare function validateConsumedBurnProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void;
