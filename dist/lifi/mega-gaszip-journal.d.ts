import { SecureStateStore } from "../secure-state-store.js";
import { type Hex } from "viem";
import type { BridgeOwner, BridgeProviderBinding } from "./model.js";
export interface MegaFundingPlan {
    readonly blockHash: Hex;
    readonly nonce: string;
    readonly gas: string;
    readonly maxFee: string;
    readonly tip: string;
    readonly l1FeeUpper: string;
    readonly operatorFeeUpper: string;
    readonly feeUpper: string;
}
export interface MegaFundingRecord {
    readonly schemaVersion: "apn.mega-gaszip-operation.v1";
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
    readonly plan: MegaFundingPlan;
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
export declare function sealMegaFunding(body: Omit<MegaFundingRecord, "integrityHash">): MegaFundingRecord;
export declare function validateMegaFunding(value: unknown): MegaFundingRecord;
export declare function publicMegaFunding(r: MegaFundingRecord): unknown;
export declare class MegaFundingJournal extends SecureStateStore {
    private path;
    findOperation(id: string): Promise<MegaFundingRecord | null>;
    listAllOperations(): Promise<readonly MegaFundingRecord[]>;
    listOperations(profileHash: string): Promise<readonly MegaFundingRecord[]>;
    saveLocked(r: MegaFundingRecord, create?: boolean): Promise<void>;
    sealTransaction(r: MegaFundingRecord, raw: Hex): Promise<MegaFundingRecord>;
    assertNoEffectClaimsLocked(r: MegaFundingRecord): Promise<void>;
    claimSigningLocked(r: MegaFundingRecord): Promise<void>;
    claimSendLocked(r: MegaFundingRecord): Promise<void>;
    claimDestinationLocked(hash: Hex, id: string): Promise<void>;
}
