import type { CircleObservation } from "./circle-v2-evm/protocol.js";
import type { EvmNativeCustody } from "./evm-native-custody.js";
/** Finite cross-controller contract. No persisted request or proof is dispatch authority.
 * A calls execute only outside its locks. B reacquires native/profile/policy locks and revalidates
 * the exact saved parent, recovery sidecar, canonical evidence and private foreground authority. */
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
/** Public finalized chain/accounting evidence, never encrypted or private signed material.
 * A independently revalidates canonical RPC evidence and stage-specific nonce86/87; B validates
 * its own native ledger and claim identity. Cancellation cost never enters Circle usage. */
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
export interface Cleanup85CancellationStatus {
    readonly operationId: string | null;
    readonly phase: "absent" | "prepared" | "unknown" | "finalized";
    readonly transactionHash: string | null;
    readonly proof: Cleanup85CancellationProof | null;
}
export interface Cleanup85CancellationPort {
    /** Explicit fresh foreground financial action. A sidecar alone never calls this from observe. */
    execute(request: Cleanup85CancellationRequest): Promise<Cleanup85CancellationStatus>;
    /** Public-only proof reconciliation, no prepare, custody key/material access, sign or send. */
    inspect(request: Cleanup85CancellationRequest): Promise<Cleanup85CancellationStatus>;
}
