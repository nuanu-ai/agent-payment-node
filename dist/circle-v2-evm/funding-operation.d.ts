import { type CircleDestinationChain } from "./catalog.js";
import { type CircleAttestation } from "./protocol.js";
import { type CircleOperationV1, type CircleRole, type CircleEnvelope } from "./operation-model.js";
import { type CircleFundingBindingV2, type CircleFundingFeeV2 } from "./funding-binding.js";
export interface CircleFundingOperationV2 extends Omit<CircleOperationV1, "schemaVersion" | "externalFulfillment" | "nonceRetirement" | "state"> {
    readonly schemaVersion: "apn.circle-v2-evm-operation.v2";
    readonly funding: CircleFundingBindingV2;
    readonly feeQuote: CircleFundingFeeV2;
    readonly state: Exclude<CircleOperationV1["state"], "nonce_retired" | "external_fulfilled">;
}
/** Initial source envelopes and the economic/authority context remain immutable through every transition. */
export declare function circleFundingFingerprint(op: Pick<CircleFundingOperationV2, "requestHash" | "funding" | "feeQuote" | "sourceCustody" | "destinationCustody" | "policies" | "deploymentDigest" | "effects" | "preparedAt" | "expiresAt">): string;
export declare function sealCircleFundingOperation(input: Omit<CircleFundingOperationV2, "integrityHash"> | CircleFundingOperationV2): CircleFundingOperationV2;
export declare function advanceCircleFundingOperation(op: CircleFundingOperationV2, patch: Partial<CircleFundingOperationV2>, reason: string, now: number): CircleFundingOperationV2;
export declare function validateCircleFundingEnvelope(e: CircleEnvelope, role: CircleRole, chain: CircleDestinationChain, attestation: CircleAttestation | null, destinationProfile: string, funding: CircleFundingBindingV2): void;
export declare function validateCircleFundingOperation(value: unknown): CircleFundingOperationV2;
export declare function publicCircleFundingOperation(op: CircleFundingOperationV2): {
    operation_id: string;
    kind: string;
    state: "completed" | "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "cleaned" | "cancelled_unsubmitted";
    terminal: boolean;
    source_profile: string;
    destination_profile: string;
    destination_chain: CircleDestinationChain;
    amount_atomic: string;
    minimum_output_atomic: string;
    maximum_issuer_fee_atomic: string;
    recipient: `0x${string}`;
    effects: {
        role: CircleRole;
        phase: import("./operation-model.js").CircleEffectPhase;
        transaction_hash: `0x${string}` | null;
        actual_fee_atomic: string | null;
    }[];
    source_finality: "safe" | "included" | "finalized" | null;
    destination_finality: "safe" | "included" | "finalized" | null;
    residual_allowance_atomic: string;
    usage_finalized: boolean;
    integrity_hash: string;
    next_actions: string[];
};
/** Closed internal dispatcher; historical validators remain v1-only. */
export type CircleKnownOperation = CircleOperationV1 | CircleFundingOperationV2;
export declare function validateKnownCircle(value: unknown): CircleKnownOperation;
export declare function publicKnownCircle(op: CircleKnownOperation): {
    next_actions: string[];
    external_fulfillment?: import("./external-proof.js").CircleExternalFulfillment;
    proof_class?: string;
    destination_finality_external?: string;
    controlled_destination_native_atomic?: string;
    source_budget_native_atomic?: string;
    source_actual_native_atomic?: string;
    destination_fee_payer?: `0x${string}`;
    cleanup_retirement_receipt?: import("./nonce-retirement-proof.js").CircleNonceRetirementProof;
    operation_id: string;
    kind: string;
    state: "completed" | "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "cleaned" | "cancelled_unsubmitted" | "nonce_retired" | "external_fulfilled";
    terminal: boolean;
    source_profile: string;
    destination_profile: string;
    destination_chain: CircleDestinationChain;
    amount_atomic: string;
    minimum_output_atomic: string;
    effects: {
        role: CircleRole;
        phase: import("./operation-model.js").CircleEffectPhase;
        transaction_hash: `0x${string}` | null;
        actual_fee_atomic: string | null;
    }[];
    source_finality: "safe" | "included" | "finalized" | null;
    destination_finality: "safe" | "included" | "finalized" | null;
    nonce: `0x${string}` | null;
    residual_allowance_atomic: string;
    usage_finalized: boolean;
    integrity_hash: string;
} | {
    operation_id: string;
    kind: string;
    state: "completed" | "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "cleaned" | "cancelled_unsubmitted";
    terminal: boolean;
    source_profile: string;
    destination_profile: string;
    destination_chain: CircleDestinationChain;
    amount_atomic: string;
    minimum_output_atomic: string;
    maximum_issuer_fee_atomic: string;
    recipient: `0x${string}`;
    effects: {
        role: CircleRole;
        phase: import("./operation-model.js").CircleEffectPhase;
        transaction_hash: `0x${string}` | null;
        actual_fee_atomic: string | null;
    }[];
    source_finality: "safe" | "included" | "finalized" | null;
    destination_finality: "safe" | "included" | "finalized" | null;
    residual_allowance_atomic: string;
    usage_finalized: boolean;
    integrity_hash: string;
    next_actions: string[];
};
