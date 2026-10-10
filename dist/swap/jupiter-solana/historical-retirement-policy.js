import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry } from "../../asset-policy-registry.js";
import { SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT } from "./catalog.js";
import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_PAYER } from "./historical-pins.js";
import { JUPITER_V1_OLD_ROUTE } from "./v1-route-config.js";
/** Fixed historical SOL->USDC route; current owner permission is distinct from the original policy. */
export function calculateHistoricalRetirementPolicy(active, operationId, nativeUsageAtomic, usdcUsageAtomic, minimumOutputAtomic, at) {
    if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId) || active === null || active.profile !== "solana-local" ||
        active.accounts.solana !== HISTORICAL_JUPITER_PAYER || !Number.isSafeInteger(active.revision) || active.revision < 1 ||
        !/^[a-f0-9]{64}$/u.test(active.activationDigest) || !(at instanceof Date) || !Number.isFinite(at.getTime()))
        refuse();
    if (!Number.isFinite(Date.parse(active.activatedAt)) || new Date(active.activatedAt).toISOString() !== active.activatedAt)
        refuse();
    const registry = validateAssetPolicyRegistry(active.registry), accountingAt = at.toISOString();
    if (active.digest !== registry.policyDigest || active.activatedAt > accountingAt ||
        !/^(?:0|[1-9][0-9]*)$/u.test(nativeUsageAtomic) || BigInt(nativeUsageAtomic) < 1000000n)
        refuse();
    const chain = `solana:${SOLANA_MAINNET_GENESIS}`;
    const input = { chain, asset: { kind: "native", identifier: null }, rail: "swap",
        asOfDate: accountingAt.slice(0, 10), asOf: accountingAt };
    // Full cap checks the per-operation permission. Delta is evaluated against U INCLUDING the old hold.
    const full = evaluateAssetPolicy(registry, { ...input, amountAtomic: "6000000", dailyUsageAtomic: "0" });
    const delta = evaluateAssetPolicy(registry, { ...input, amountAtomic: "5000000", dailyUsageAtomic: nativeUsageAtomic });
    const output = evaluateAssetPolicy(registry, { ...input, asset: { kind: "token", identifier: SOLANA_USDC_MINT },
        amountAtomic: minimumOutputAtomic, dailyUsageAtomic: usdcUsageAtomic });
    if ([full, delta, output].some(value => canonicalJson(value.asset.mechanismPins?.swap ?? null) !== canonicalJson(JUPITER_V1_OLD_ROUTE.mechanismPin)))
        refuse();
    const body = { kind: "jupiter_historical_retirement_policy_calculation", operationId,
        policyDigest: active.digest, activationDigest: active.activationDigest, policyRevision: active.revision, accountingAt,
        originalReservationAtomic: "1000000", conservativeTotalAtomic: "6000000",
        additionalAdmissionAtomic: "5000000", priorNativeUsageAtomic: nativeUsageAtomic,
        priorUsdcUsageAtomic: usdcUsageAtomic, resultingNativeUsageAtomic: (BigInt(nativeUsageAtomic) + 5000000n).toString(),
        maximumPerTransferAtomic: full.caps.maximumPerTransferAtomic, dailyLimitAtomic: full.caps.dailyLimitAtomic,
        policyExpiresAt: registry.expiresAt ?? null };
    return Object.freeze({ ...body, calculationHash: domainHash("apn.jupiter-historical-retirement-policy.v1", canonicalJson(body)) });
}
function refuse() { throw new ApnError("APN_OPERATION_BLOCKED", "The current finite historical Jupiter retirement policy is unavailable."); }
//# sourceMappingURL=historical-retirement-policy.js.map