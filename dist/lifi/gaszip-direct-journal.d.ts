import { type GaszipTerminalState } from "./gaszip-outcome.js";
import { SecureStateStore } from "../secure-state-store.js";
import { type Hex } from "viem";
import { type GaszipDirectRoute } from "./gaszip-direct-route.js";
import type { BridgeOwner, BridgeProviderBinding } from "./model.js";
export interface GaszipFundingPlan {
    readonly blockHash: Hex;
    readonly nonce: string;
    readonly gas: string;
    readonly maxFee: string;
    readonly tip: string;
    readonly l1FeeUpper: string;
    readonly operatorFeeUpper: string;
    readonly feeUpper: string;
}
export interface GaszipFundingRecord {
    readonly schemaVersion: GaszipDirectRoute["schemaVersion"];
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
    readonly plan: GaszipFundingPlan;
    readonly state: "prepared" | "signing_started" | "sealed" | "submitting" | "submitted" | "unknown_finality" | GaszipTerminalState;
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
export declare function sealGaszipFunding(route: GaszipDirectRoute, body: Omit<GaszipFundingRecord, "integrityHash">): GaszipFundingRecord;
/** Checked against the record's own seal and owner record; the route table supplies only protocol data (target, calldata, chain). */
export declare function validateGaszipFunding(route: GaszipDirectRoute, value: unknown): GaszipFundingRecord;
export declare function publicGaszipFunding(route: GaszipDirectRoute, r: GaszipFundingRecord): unknown;
/** One journal per route; each keeps the directories and claim files its route has always written. */
export declare class GaszipFundingJournal extends SecureStateStore {
    readonly route: GaszipDirectRoute;
    private readonly directory;
    constructor(root: string, route: GaszipDirectRoute);
    private path;
    findOperation(id: string): Promise<GaszipFundingRecord | null>;
    listAllOperations(): Promise<readonly GaszipFundingRecord[]>;
    listOperations(profileHash: string): Promise<readonly GaszipFundingRecord[]>;
    saveLocked(r: GaszipFundingRecord, create?: boolean): Promise<void>;
    sealTransaction(r: GaszipFundingRecord, raw: Hex): Promise<GaszipFundingRecord>;
    assertNoEffectClaimsLocked(r: GaszipFundingRecord): Promise<void>;
    /** The create-only first-send marker precedes every broadcast; without it APN never sent these bytes. */
    sendClaimedLocked(r: {
        operationId: string;
    }): Promise<boolean>;
    claimSigningLocked(r: GaszipFundingRecord): Promise<void>;
    claimSendLocked(r: GaszipFundingRecord): Promise<void>;
    /** Caller holds `<lane>-gaszip:destination-claims`; one destination payout can complete only one operation. */
    claimDestinationLocked(hash: Hex, id: string): Promise<void>;
}
