import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry } from "../../asset-policy-registry.js";
import { SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT } from "./catalog.js";
import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_PAYER } from "./historical-pins.js";
import { JUPITER_V1_OLD_ROUTE } from "./v1-route-config.js";

/** Public calculation only. This result never grants permission to create a retirement record. */
export interface HistoricalRetirementPolicyAdmission {
 readonly kind: "jupiter_historical_retirement_policy_calculation";
 readonly operationId: string; readonly policyDigest: string; readonly activationDigest: string;
 readonly policyRevision: number; readonly accountingAt: string;
 readonly originalReservationAtomic: "1000000"; readonly conservativeTotalAtomic: "6000000";
 readonly additionalAdmissionAtomic: "5000000"; readonly priorNativeUsageAtomic: string;
 readonly priorUsdcUsageAtomic: string; readonly resultingNativeUsageAtomic: string; readonly maximumPerTransferAtomic: string;
 readonly dailyLimitAtomic: string; readonly policyExpiresAt: string | null; readonly calculationHash: string;
}
/** Fixed historical SOL->USDC route; current owner permission is distinct from the original policy. */
export function calculateHistoricalRetirementPolicy(active: ActiveAssetPolicy | null, operationId: string,
 nativeUsageAtomic: string, usdcUsageAtomic: string, minimumOutputAtomic: string, at: Date): HistoricalRetirementPolicyAdmission {
 if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId) || active === null || active.profile !== "solana-local" ||
   active.accounts.solana !== HISTORICAL_JUPITER_PAYER || !Number.isSafeInteger(active.revision) || active.revision < 1 ||
   !/^[a-f0-9]{64}$/u.test(active.activationDigest) || !(at instanceof Date) || !Number.isFinite(at.getTime())) refuse();
 if (!Number.isFinite(Date.parse(active.activatedAt)) || new Date(active.activatedAt).toISOString() !== active.activatedAt) refuse();
 const registry = validateAssetPolicyRegistry(active.registry), accountingAt = at.toISOString();
 if (active.digest !== registry.policyDigest || active.activatedAt > accountingAt ||
   !/^(?:0|[1-9][0-9]*)$/u.test(nativeUsageAtomic) || BigInt(nativeUsageAtomic) < 1_000_000n) refuse();
 const chain = `solana:${SOLANA_MAINNET_GENESIS}`;
 const input = { chain, asset: { kind: "native" as const, identifier: null }, rail: "swap" as const,
   asOfDate: accountingAt.slice(0, 10), asOf: accountingAt };
 // Full cap checks the per-operation permission. Delta is evaluated against U INCLUDING the old hold.
 const full = evaluateAssetPolicy(registry, { ...input, amountAtomic: "6000000", dailyUsageAtomic: "0" });
 const delta = evaluateAssetPolicy(registry, { ...input, amountAtomic: "5000000", dailyUsageAtomic: nativeUsageAtomic });
 const output = evaluateAssetPolicy(registry, { ...input, asset: { kind: "token", identifier: SOLANA_USDC_MINT },
   amountAtomic: minimumOutputAtomic, dailyUsageAtomic: usdcUsageAtomic });
 if ([full, delta, output].some(value => canonicalJson(value.asset.mechanismPins?.swap ?? null) !== canonicalJson(JUPITER_V1_OLD_ROUTE.mechanismPin))) refuse();
 const body = { kind: "jupiter_historical_retirement_policy_calculation" as const, operationId,
   policyDigest: active.digest, activationDigest: active.activationDigest, policyRevision: active.revision, accountingAt,
   originalReservationAtomic: "1000000" as const, conservativeTotalAtomic: "6000000" as const,
   additionalAdmissionAtomic: "5000000" as const, priorNativeUsageAtomic: nativeUsageAtomic,
   priorUsdcUsageAtomic: usdcUsageAtomic, resultingNativeUsageAtomic: (BigInt(nativeUsageAtomic) + 5_000_000n).toString(),
   maximumPerTransferAtomic: full.caps.maximumPerTransferAtomic, dailyLimitAtomic: full.caps.dailyLimitAtomic,
   policyExpiresAt: registry.expiresAt ?? null };
 return Object.freeze({ ...body, calculationHash: domainHash("apn.jupiter-historical-retirement-policy.v1", canonicalJson(body)) });
}
function refuse(): never { throw new ApnError("APN_OPERATION_BLOCKED", "The current finite historical Jupiter retirement policy is unavailable."); }
