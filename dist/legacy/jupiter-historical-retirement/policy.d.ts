import type { ActiveAssetPolicy } from "../../allowlist-active-policy.js";
/** Public calculation only. This result never grants permission to create a retirement record. */
export interface HistoricalRetirementPolicyAdmission {
    readonly kind: "jupiter_historical_retirement_policy_calculation";
    readonly operationId: string;
    readonly policyDigest: string;
    readonly activationDigest: string;
    readonly policyRevision: number;
    readonly accountingAt: string;
    readonly originalReservationAtomic: "1000000";
    readonly conservativeTotalAtomic: "6000000";
    readonly additionalAdmissionAtomic: "5000000";
    readonly priorNativeUsageAtomic: string;
    readonly priorUsdcUsageAtomic: string;
    readonly resultingNativeUsageAtomic: string;
    readonly maximumPerTransferAtomic: string;
    readonly dailyLimitAtomic: string;
    readonly policyExpiresAt: string | null;
    readonly calculationHash: string;
}
/** Recomputes a stored record's policy calculation from the registry the record itself carries. */
export declare function calculateHistoricalRetirementPolicy(active: ActiveAssetPolicy | null, operationId: string, nativeUsageAtomic: string, usdcUsageAtomic: string, minimumOutputAtomic: string, at: Date): HistoricalRetirementPolicyAdmission;
