import { SecureStateStore } from "../secure-state-store.js";
import { type Hex } from "viem";
import type { BridgeOwner, BridgeProviderBinding } from "./model.js";
export interface SeiFundingPlan {
    readonly blockHash: Hex;
    readonly nonce: string;
    readonly gas: string;
    readonly maxFee: string;
    readonly tip: string;
    readonly l1FeeUpper: string;
    readonly operatorFeeUpper: string;
    readonly feeUpper: string;
}
export interface SeiFundingRecord {
    readonly schemaVersion: "apn.sei-gaszip-operation.v1";
    readonly operationId: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly profile: string;
    readonly owner: BridgeOwner;
    readonly providerBinding: BridgeProviderBinding;
    readonly amountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly maximumFeeAtomic: string;
    readonly quoteDigest: string;
    readonly quoteExpectedAtomic: string;
    readonly expiresAt: string;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly activationDigest?: string;
    readonly plan: SeiFundingPlan;
    readonly state: "prepared" | "signing_started" | "sealed" | "submitting" | "submitted" | "unknown_finality" | "completed" | "failed_before_effect" | "failed_confirmed_revert";
    readonly terminal: boolean;
    readonly rawTransaction: Hex | null;
    readonly transactionHash: Hex | null;
    readonly submissionAttempts: 0 | 1;
    readonly usageReservationId: string | null;
    readonly outcomeDigest: string | null;
    readonly sourceProof: unknown | null;
    readonly destinationProof: unknown | null;
    readonly integrityHash: string;
}
export declare function sealSeiFunding(body: Omit<SeiFundingRecord, "integrityHash">): SeiFundingRecord;
export declare function validateSeiFunding(value: unknown): SeiFundingRecord;
export declare function publicSeiFunding(r: SeiFundingRecord): unknown;
export declare class SeiFundingJournal extends SecureStateStore {
    private path;
    findOperation(id: string): Promise<SeiFundingRecord | null>;
    listAllOperations(): Promise<readonly SeiFundingRecord[]>;
    listOperations(profileHash: string): Promise<readonly SeiFundingRecord[]>;
    saveLocked(r: SeiFundingRecord, create?: boolean): Promise<void>;
    sealTransaction(r: SeiFundingRecord, raw: Hex): Promise<SeiFundingRecord>;
    assertNoEffectClaimsLocked(r: SeiFundingRecord): Promise<void>;
    claimSigningLocked(r: SeiFundingRecord): Promise<void>;
    claimSendLocked(r: SeiFundingRecord): Promise<void>;
    claimDestinationLocked(hash: Hex, id: string): Promise<void>;
}
