import { type Address, type Hex } from "viem";
import { type EvmNativeCustody } from "../evm-native-custody.js";
import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import { type CircleDestinationChain } from "./catalog.js";
import { type CircleSourceProof, type CircleAttestation, type CircleReceiptProof, type decodeCircleDestination } from "./protocol.js";
export type CircleRole = "approval" | "burn" | "mint" | "cleanup";
export type CircleEffectPhase = "prepared" | "signing_started" | "sealed" | "submission_started" | "submitted" | "unknown" | "confirmed" | "reverted";
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
}
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
    readonly state: "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "completed" | "cleaned" | "cancelled_unsubmitted";
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
}
export declare function circleBlocked(reason: string): never;
export declare function circleCorrupt(reason: string): never;
export declare function sealCircle(input: Omit<CircleOperationV1, "integrityHash"> | CircleOperationV1): CircleOperationV1;
export declare function advanceCircle(op: CircleOperationV1, patch: Partial<CircleOperationV1>, reason: string, now: number): CircleOperationV1;
export declare function circleEnvelope(input: Omit<CircleEnvelope, "envelopeHash">): CircleEnvelope;
export declare function validateCircleEnvelope(e: CircleEnvelope, role: CircleRole, chain: CircleDestinationChain, attestation: CircleAttestation | null): void;
export declare function validateCircle(value: unknown): CircleOperationV1;
export declare function publicCircle(op: CircleOperationV1): {
    operation_id: string;
    kind: string;
    state: "completed" | "awaiting_source" | "source_unknown" | "awaiting_mint" | "mint_unknown" | "awaiting_finality" | "cleanup_required" | "cleaned" | "cancelled_unsubmitted";
    terminal: boolean;
    source_profile: string;
    destination_profile: string;
    destination_chain: CircleDestinationChain;
    amount_atomic: string;
    minimum_output_atomic: string;
    effects: {
        role: CircleRole;
        phase: CircleEffectPhase;
        transaction_hash: `0x${string}` | null;
        actual_fee_atomic: string | null;
    }[];
    source_finality: "finalized" | "safe" | "included" | null;
    destination_finality: "finalized" | "safe" | "included" | null;
    nonce: `0x${string}` | null;
    residual_allowance_atomic: string;
    usage_finalized: boolean;
    integrity_hash: string;
    next_actions: string[];
};
export declare function circleSame(a: unknown, b: unknown): boolean;
