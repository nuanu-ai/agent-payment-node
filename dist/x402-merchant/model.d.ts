import { type MerchantFailure } from "./failure.js";
import { type MerchantFeeContext } from "./mega-fee.js";
import type { Hex } from "viem";
import type { EvmNativeCustody } from "../evm-native-custody.js";
import { type FrozenMerchantChallenge } from "./protocol.js";
import type { MerchantAssetPin } from "./asset-pins.js";
export interface MerchantEnvelope {
    readonly nonce: string;
    readonly gas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
    readonly maximumNativeFee: string;
    readonly nativeFeeReserveWei?: string;
}
/** Every phase a merchant payment may hold, and its outcomes (the record's `terminal` flag must equal membership). */
export declare const MERCHANT_PHASES: readonly ["prepared", "signing_started", "submission_started", "unknown_finality", "payment_finalized", "delivery_unknown", "delivered", "reverted", "retired_unsent", "failed_before_effect", "failed_proven_superseded", "abandoned_unknown", "delivery_failed"];
export declare const MERCHANT_TERMINAL_PHASES: readonly MerchantPhase[];
export type MerchantPhase = typeof MERCHANT_PHASES[number];
/** The most merchant GETs that may carry one payment's proof (started and outcome rows, two per GET). */
export declare const MERCHANT_DELIVERY_ATTEMPT_LIMIT = 16;
/**
 * Why a payment ended without a merchant delivery (phase 4c exits). `never_signed`: custody was never asked to sign;
 * `signature_never_left_process`: a signature may have existed only inside a process that died before sealing it, and
 * nothing is sent before the durable submission fence; `finalized_nonce_superseded`: another transaction took the
 * payment's nonce at the finalized tag and the node knows neither this transaction nor a receipt; `owner_abandoned`:
 * the owner's TTY consent ended an attempt no proof could decide; `delivery_attempts_exhausted`: the finalized payment's
 * proof was offered to the merchant the maximum number of times without an HTTP 200 delivery.
 */
export interface MerchantExit {
    readonly reason: "never_signed" | "signature_never_left_process" | "finalized_nonce_superseded" | "owner_abandoned" | "delivery_attempts_exhausted";
    readonly finalizedNonce?: string;
    readonly transactionHash?: Hex;
}
export interface MerchantReceipt {
    readonly transactionHash: Hex;
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly finality: "finalized";
    readonly status: "success" | "reverted";
    readonly evidenceHash: string;
    readonly networkFeeWei: string;
    readonly fullFee?: {
        readonly executionWei: string;
        readonly l1Wei: string;
        readonly operatorWei: string;
        readonly signedExecutionCapWei: string;
        readonly admissionEstimatedUpperWei: string;
        readonly payerDebit: {
            readonly before: string;
            readonly after: string;
            readonly aggregateDebit: string;
            readonly transactionHashes: readonly Hex[];
            readonly evidenceHash: string;
        };
    };
    readonly canonical?: {
        readonly transactionIndex: string;
        readonly blockHeaderHash: string;
        readonly finalizedNumber: string;
        readonly finalizedHash: Hex;
        readonly finalizedHeaderHash: string;
    };
}
export interface MerchantCanonicalObservation {
    readonly at: string;
    readonly result: "verified" | "mismatch" | "unavailable";
    readonly reason: string;
    readonly chain: "eip155:4326";
    readonly origin: "https://mainnet.megaeth.com";
    readonly priorReceiptHash: string;
    readonly deliveryCount: number;
    readonly priorDeliveryHash: string;
    readonly currentReceiptHash: string | null;
    readonly currentAnchors: NonNullable<MerchantReceipt["canonical"]> | null;
    readonly previousHash: string | null;
    readonly observationHash: string;
}
export interface MerchantEvent {
    readonly at: string;
    readonly state: MerchantPhase;
    readonly previousHash: string | null;
    readonly snapshotHash: string;
    readonly eventHash: string;
}
export interface MerchantOperation {
    /** v1: the x402engine Bitcoin-price lane (legacy mechanism, read and finish only). v2: any merchant (`url`, `asset`). */
    readonly schemaVersion: "apn.x402-merchant.v1" | "apn.x402-merchant.v2";
    readonly kind: "merchant_x402";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly custody: EvmNativeCustody;
    readonly frozen: FrozenMerchantChallenge;
    /** v2 only: the canonical merchant URL (`--url`) the challenge, proof and delivery use. */
    readonly url?: string;
    /** v2 only: the pinned asset the selected challenge row named, frozen as it was at prepare. */
    readonly asset?: MerchantAssetPin;
    readonly envelope: MerchantEnvelope;
    readonly policy: {
        readonly digest: string;
        readonly revision: number;
        readonly activationDigest: string;
    };
    readonly failures?: readonly MerchantFailure[];
    readonly retirementDigest?: string;
    readonly feeContext?: MerchantFeeContext;
    readonly effectBinding?: {
        readonly policyEndsAt: string;
        readonly nativeAmountAtomic: string;
    };
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly state: MerchantPhase;
    readonly terminal: boolean;
    readonly signingAttempts: 0 | 1;
    readonly submissionAttempts: 0 | 1;
    readonly txHash: Hex | null;
    readonly receipt: MerchantReceipt | null;
    readonly deliveryAttempts: readonly {
        readonly at: string;
        readonly proofHash: string;
        readonly outcome: "started" | "unknown" | "delivered";
        readonly httpStatus?: number;
        readonly bodyHash?: string;
        readonly headers?: readonly (readonly [
            string,
            string
        ])[];
        readonly result?: Record<string, unknown>;
    }[];
    readonly events: readonly MerchantEvent[];
    readonly integrityHash: string;
    readonly canonicalObservations?: readonly MerchantCanonicalObservation[];
    /** Present exactly in the phase 4c exit states. */
    readonly exit?: MerchantExit;
}
export declare function merchantFingerprint(o: Omit<MerchantOperation, "fingerprint" | "integrityHash">): string;
export declare function sealMerchant(o: Omit<MerchantOperation, "integrityHash">): MerchantOperation;
export declare function merchantSnapshot(o: Pick<MerchantOperation, "state" | "signingAttempts" | "submissionAttempts" | "txHash" | "receipt" | "deliveryAttempts">): string;
export declare function merchantMove(o: MerchantOperation, state: MerchantPhase, at: string, changes?: Partial<Pick<MerchantOperation, "signingAttempts" | "submissionAttempts" | "txHash" | "receipt" | "deliveryAttempts" | "retirementDigest" | "exit">>): MerchantOperation;
export declare function validateMerchant(v: unknown): MerchantOperation;
export declare function publicMerchant(o: MerchantOperation): {
    exit: MerchantExit | null;
    currentCanonicalProof: MerchantCanonicalObservation | null;
    result: Record<string, unknown> | null | undefined;
    receipt: MerchantReceipt | null;
    nativeFeeReserveWei?: string;
    failures: readonly MerchantFailure[];
    retirementDigest: string | null;
    retirementReceipt: {
        kind: string;
        tombstoneDigest: string | undefined;
        consumedAtomic: string;
        payment: boolean;
        delivery: boolean;
    } | null;
    feeBudgetSemantics?: string;
    signedExecutionCapWei?: string;
    admissionEstimatedUpperWei?: string;
    l1EstimatedUpperWei?: string;
    operatorEstimatedUpperWei?: string;
    feeRule?: "apn.merchant-mega-fee.v1" | "apn.merchant-mega-fee.v2";
    kind: "merchant_x402";
    operationId: string;
    state: "prepared" | "signing_started" | "submission_started" | "reverted" | "unknown_finality" | "failed_before_effect" | "payment_finalized" | "delivery_unknown" | "delivered" | "retired_unsent" | "failed_proven_superseded" | "abandoned_unknown" | "delivery_failed";
    terminal: boolean;
    mechanism: string;
    provider: {
        id: string;
        reference: string;
        protocolSnapshot: string | null;
        assetTransferMethod: string;
        eip3009: boolean;
        gasless: boolean;
    };
    url: string;
    payer: string;
    payee: string;
    asset: {
        chain: "eip155:4326";
        token: string;
        symbol: string;
        decimals: number;
    };
    legacyMechanism: {
        readonly provider: "x402engine-erc20-transfer-proof";
        readonly reference: "megaeth-usdm-crypto-price-v1";
    } | null;
    paymentFinalized: boolean;
    merchantDelivered: boolean;
    transactionHash: `0x${string}` | null;
    challengeHash: string;
    paymentWindowSeconds: unknown;
    expiresAt: string;
    amountAtomic: unknown;
    feeCeilingWei: string;
};
