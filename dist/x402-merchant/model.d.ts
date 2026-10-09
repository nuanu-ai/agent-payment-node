import type { Hex } from "viem";
import type { EvmNativeCustody } from "../evm-native-custody.js";
import { type FrozenMerchantChallenge } from "./protocol.js";
export interface MerchantEnvelope {
    readonly nonce: string;
    readonly gas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
    readonly maximumNativeFee: string;
}
export type MerchantPhase = "prepared" | "signing_started" | "submission_started" | "unknown_finality" | "payment_finalized" | "delivery_unknown" | "delivered" | "reverted";
export interface MerchantReceipt {
    readonly transactionHash: Hex;
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly finality: "finalized";
    readonly status: "success" | "reverted";
    readonly evidenceHash: string;
    readonly networkFeeWei: string;
}
export interface MerchantEvent {
    readonly at: string;
    readonly state: MerchantPhase;
    readonly previousHash: string | null;
    readonly snapshotHash: string;
    readonly eventHash: string;
}
export interface MerchantOperation {
    readonly schemaVersion: "apn.x402-merchant.v1";
    readonly kind: "merchant_x402";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly custody: EvmNativeCustody;
    readonly frozen: FrozenMerchantChallenge;
    readonly envelope: MerchantEnvelope;
    readonly policy: {
        readonly digest: string;
        readonly revision: number;
        readonly activationDigest: string;
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
}
export declare function merchantFingerprint(o: Omit<MerchantOperation, "fingerprint" | "integrityHash">): string;
export declare function sealMerchant(o: Omit<MerchantOperation, "integrityHash">): MerchantOperation;
export declare function merchantSnapshot(o: Pick<MerchantOperation, "state" | "signingAttempts" | "submissionAttempts" | "txHash" | "receipt" | "deliveryAttempts">): string;
export declare function merchantMove(o: MerchantOperation, state: MerchantPhase, at: string, changes?: Partial<Pick<MerchantOperation, "signingAttempts" | "submissionAttempts" | "txHash" | "receipt" | "deliveryAttempts">>): MerchantOperation;
export declare function validateMerchant(v: unknown): MerchantOperation;
export declare function publicMerchant(o: MerchantOperation): {
    kind: "merchant_x402";
    operationId: string;
    state: MerchantPhase;
    terminal: boolean;
    mechanism: string;
    provider: {
        id: string;
        reference: string;
        protocolSnapshot: string;
        assetTransferMethod: string;
        eip3009: boolean;
        gasless: boolean;
    };
    paymentFinalized: boolean;
    merchantDelivered: boolean;
    transactionHash: `0x${string}` | null;
    challengeHash: string;
    expiresAt: string;
    amountAtomic: unknown;
    feeCeilingWei: string;
    result: Record<string, unknown> | null | undefined;
    receipt: MerchantReceipt | null;
};
