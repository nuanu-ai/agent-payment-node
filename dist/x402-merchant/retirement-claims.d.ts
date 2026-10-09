import { SecureStateStore } from "../secure-state-store.js";
import type { MerchantOperation } from "./model.js";
export interface MerchantRetirementClaim {
    readonly schemaVersion: "apn.merchant-retirement.v1";
    readonly operationId: string;
    readonly profileHash: string;
    readonly fingerprint: string;
    readonly sourceNonce: string;
    readonly signClaimDigest: string;
    readonly priorIntegrityHash: string;
    readonly retiredAt: string;
    readonly proofHash: string;
    readonly claimDigest: string;
}
export declare class MerchantRetirementClaims extends SecureStateStore {
    private path;
    assertNoRetirement(o: MerchantOperation): Promise<void>;
    unsent(o: MerchantOperation): Promise<string>;
    find(o: MerchantOperation): Promise<MerchantRetirementClaim | null>;
    mark(o: MerchantOperation, proofHash: string, at: string): Promise<MerchantRetirementClaim>;
}
