import { type CircleExternalFulfillment } from "./external-proof.js";
import { type CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import type { Address, Hex } from "viem";
import { type EvmNativeCustody } from "../evm-native-custody.js";
import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import { type CircleDestinationChain } from "./catalog.js";
import { type CircleSourceProof, type CircleAttestation, type CircleReceiptProof, type decodeCircleDestination } from "./protocol.js";
export type CircleRole = "approval" | "burn" | "mint" | "cleanup";
export type CircleEffectPhase = "prepared" | "signing_started" | "sealed" | "submission_started" | "submitted" | "unknown" | "confirmed" | "reverted" | "abandoned_unsent";
export interface CircleEnvelope {
    readonly chainId: number;
    readonly from: Address;
    readonly to: Address;
    readonly data: Hex;
    readonly valueAtomic: "0";
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    /** v2 envelopes frozen since the never-lands index proof: the latest block read while freezing it (bound by envelopeHash). */
    readonly eraBlock?: {
        readonly numberAtomic: string;
        readonly hash: Hex;
    };
    readonly envelopeHash: string;
}
export interface CircleEffect {
    readonly role: CircleRole;
    readonly phase: CircleEffectPhase;
    readonly envelope: CircleEnvelope;
    readonly transactionHash: Hex | null;
    readonly materialHash: string | null;
    readonly proof: CircleReceiptProof | null;
}
export interface CirclePolicy {
    readonly profile: string;
    readonly profileHash: string;
    readonly policyDigest: string;
    readonly revision: number;
    readonly activationDigest?: string;
}
/** Every state a v1 Circle route may hold, and its outcomes (the record's `terminal` flag must equal membership). */
export declare const CIRCLE_V1_STATES: readonly ["awaiting_source", "source_unknown", "awaiting_mint", "mint_unknown", "awaiting_finality", "cleanup_required", "completed", "cleaned", "cancelled_unsubmitted", "nonce_retired", "external_fulfilled"];
export declare const CIRCLE_V1_TERMINAL_STATES: readonly string[];
export interface CircleOperationV1 {
    readonly schemaVersion: "apn.circle-v2-evm-operation.v1";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly destinationProfile: string;
    readonly destinationProfileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly destinationChain: CircleDestinationChain;
    readonly sourceCustody: EvmNativeCustody;
    readonly destinationCustody: EvmNativeCustody;
    readonly policies: readonly CirclePolicy[];
    readonly preparedAt: string;
    readonly expiresAt: string;
    readonly deploymentDigest: string;
    readonly feeQuoteAtomic: string;
    readonly state: typeof CIRCLE_V1_STATES[number];
    readonly terminal: boolean;
    readonly effects: readonly CircleEffect[];
    readonly source: CircleSourceProof | null;
    readonly attestation: CircleAttestation | null;
    readonly destination: ReturnType<typeof decodeCircleDestination> | null;
    readonly residualAllowanceAtomic: string;
    readonly usage: readonly AssetUsageReservation[];
    readonly usageFinalized: boolean;
    readonly transitions: readonly {
        readonly sequence: number;
        readonly at: string;
        readonly reason: string;
        readonly previousHash: string | null;
        readonly snapshotHash: string;
    }[];
    readonly integrityHash: string;
    readonly externalFulfillment?: CircleExternalFulfillment;
    readonly nonceRetirement?: CircleNonceRetirementProof;
}
export declare function circleBlocked(reason: string): never;
export declare function circleCorrupt(reason: string): never;
export declare function circleEnvelope(input: Omit<CircleEnvelope, "envelopeHash">): CircleEnvelope;
export declare function validateCircleEnvelope(e: CircleEnvelope, role: CircleRole, chain: CircleDestinationChain, attestation: CircleAttestation | null, destinationProfile?: string): void;
export declare function validateCircle(value: unknown): CircleOperationV1;
export declare function publicCircle(op: CircleOperationV1): {
    next_actions: string[];
    external_fulfillment?: CircleExternalFulfillment;
    proof_class?: string;
    destination_finality_external?: string;
    controlled_destination_native_atomic?: string;
    source_budget_native_atomic?: string;
    source_actual_native_atomic?: string;
    destination_fee_payer?: `0x${string}`;
    cleanup_retirement_receipt?: CircleNonceRetirementProof;
    operation_id: string;
    kind: string;
    state: "completed" | "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "cleaned" | "cancelled_unsubmitted" | "nonce_retired" | "external_fulfilled";
    terminal: boolean;
    source_profile: string;
    destination_profile: string;
    destination_chain: CircleDestinationChain;
    amount_atomic: string;
    minimum_output_atomic: string;
    actual_economics: {
        asset: {
            symbol: string;
            decimals: number;
            source_chain: string;
            source_token: `0x${string}`;
            destination_chain: string;
            destination_token: `0x${string}`;
        };
        actual_source_gross_atomic: string | null;
        source_burn_transaction_hash: `0x${string}` | null;
        source_burn_finality: "safe" | "included" | "finalized" | null;
        actual_destination_net_atomic: string | null;
        actual_issuer_fee_atomic: string | null;
        destination_mint: "external" | "owned" | null;
        destination_mint_transaction_hash: `0x${string}` | null;
        destination_mint_finality: "safe" | "included" | "finalized" | null;
    };
    effects: {
        role: CircleRole;
        phase: CircleEffectPhase;
        transaction_hash: `0x${string}` | null;
        actual_fee_atomic: string | null;
    }[];
    source_finality: "safe" | "included" | "finalized" | null;
    destination_finality: "safe" | "included" | "finalized" | null;
    nonce: `0x${string}` | null;
    residual_allowance_atomic: string;
    usage_finalized: boolean;
    integrity_hash: string;
};
export declare function circleSame(a: unknown, b: unknown): boolean;
