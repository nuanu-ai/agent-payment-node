/** Pure funding-v2 metadata only. No custody, reservation, network, CLI or execution authority. */
import { getAddress } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, circleRoute } from "./catalog.js";
export const CIRCLE_FUNDING_OPERATION_V2 = "apn.circle-v2-evm-operation.v2";
const UINT256 = (1n << 256n) - 1n;
const ZERO = `0x${"0".repeat(40)}`;
const FIELDS = ["recipient", "amountAtomic", "maxFeeAtomic", "minMintAtomic"];
function refuse(reason) { throw new ApnError("APN_INVALID_INPUT", "Circle funding metadata is invalid.", { reason }); }
function uint(value, positive = false) {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value))
        refuse("funding_quantity");
    const n = BigInt(value);
    if (n > UINT256 || positive && n === 0n)
        refuse("funding_quantity");
    return n;
}
function address(value) {
    try {
        if (typeof value !== "string" || getAddress(value) !== value || value === ZERO)
            refuse("funding_address");
        return value;
    }
    catch {
        return refuse("funding_address");
    }
}
function hash(value) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    refuse("funding_hash"); return value; }
function time(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - 900_000)
    refuse("funding_time"); }
function parameters(value) {
    if (!isPlainRecord(value) || !exactKeys(value, FIELDS))
        refuse("funding_parameter_shape");
    const recipient = address(value.recipient), amount = uint(value.amountAtomic, true), max = uint(value.maxFeeAtomic, true), min = uint(value.minMintAtomic, true);
    if (max >= amount || min > amount - max)
        refuse("funding_net_floor");
    return Object.freeze({ recipient, amountAtomic: amount.toString(), maxFeeAtomic: max.toString(), minMintAtomic: min.toString() });
}
/** All absent means the unchanged legacy input. A partial or unknown field set cannot select v2. */
export function deriveCircleFundingParameters(value) {
    if (!isPlainRecord(value))
        refuse("funding_parameter_shape");
    if (Object.keys(value).length === 0)
        return null;
    return parameters(value);
}
export function circleFundingBinding(chain, destinationProfile, value) {
    let route;
    try {
        route = circleRoute(chain, destinationProfile);
    }
    catch {
        return refuse("funding_destination");
    }
    const p = parameters(value);
    const body = { schemaVersion: "apn.circle-funding-binding.v2", ...p,
        sourceProfile: "evm-live-buyer", sourceChain: 42161, sourceDomain: 3,
        sourceOwner: CIRCLE_SOURCE_OWNER, sourceToken: CIRCLE_SOURCE_TOKEN, decimals: 6,
        destinationChain: route.chainId, destinationDomain: route.domain, destinationToken: route.token,
        destinationProfile: route.gasPayerProfile, gasPayer: route.gasPayer,
        mechanism: Object.freeze({ provider: "circle-cctp-v2", reference: `circle-v2-evm-fast-42161-${route.chainId}.v2` }) };
    return Object.freeze({ ...body, bindingHash: hashObject(body) });
}
export function validateCircleFundingBinding(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", ...FIELDS, "sourceProfile", "sourceChain", "sourceDomain", "sourceOwner", "sourceToken", "decimals",
        "destinationChain", "destinationDomain", "destinationToken", "destinationProfile", "gasPayer", "mechanism", "bindingHash"]))
        refuse("funding_binding_shape");
    const expected = circleFundingBinding(value.destinationChain, String(value.destinationProfile), Object.fromEntries(FIELDS.map(k => [k, value[k]])));
    if (hashObject(value) !== hashObject(expected))
        refuse("funding_binding_changed");
    return expected;
}
export function quoteCircleFundingFee(bindingValue, response, fetchedAtMs, nowMs) {
    const binding = validateCircleFundingBinding(bindingValue);
    time(fetchedAtMs);
    time(nowMs);
    if (fetchedAtMs > nowMs || nowMs - fetchedAtMs >= 30_000 || !Array.isArray(response) || response.length > 4)
        refuse("funding_fee_shape_age");
    if (response.some(x => !isPlainRecord(x)))
        refuse("funding_fee_shape_age");
    const rows = response.filter(x => x.finalityThreshold === 1000);
    if (rows.length !== 1)
        refuse("funding_fast_fee_unavailable");
    const rate = rows[0].minimumFee;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || !/^\d+(?:\.\d{1,6})?$/u.test(String(rate)))
        refuse("funding_fee_rate");
    const [whole, fraction = ""] = String(rate).split("."), denominator = 10n ** BigInt(fraction.length) * 10000n;
    const numerator = BigInt(`${whole}${fraction}`), fee = (BigInt(binding.amountAtomic) * numerator + denominator - 1n) / denominator;
    if (fee > BigInt(binding.maxFeeAtomic) || BigInt(binding.amountAtomic) - fee < BigInt(binding.minMintAtomic))
        refuse("funding_fee_cap_or_net_floor");
    const body = { schemaVersion: "apn.circle-fast-fee.v2", bindingHash: binding.bindingHash, minimumFeeBps: String(rate), quotedFeeAtomic: fee.toString(),
        fetchedAtMs, expiresAtMs: fetchedAtMs + 30_000, responseHash: hashObject(response) };
    return Object.freeze({ ...body, integrityHash: hashObject(body) });
}
export function assertCircleFundingFee(bindingValue, value, nowMs) {
    const binding = validateCircleFundingBinding(bindingValue);
    time(nowMs);
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "bindingHash", "minimumFeeBps", "quotedFeeAtomic", "fetchedAtMs", "expiresAtMs", "responseHash", "integrityHash"]))
        refuse("funding_fee_shape");
    const { integrityHash, ...body } = value;
    if (hashObject(body) !== integrityHash || body.schemaVersion !== "apn.circle-fast-fee.v2" || body.bindingHash !== binding.bindingHash ||
        typeof body.fetchedAtMs !== "number" || typeof body.expiresAtMs !== "number")
        refuse("funding_fee_binding");
    time(body.fetchedAtMs);
    time(body.expiresAtMs);
    hash(body.responseHash);
    if (body.expiresAtMs !== body.fetchedAtMs + 30_000 || nowMs < body.fetchedAtMs || nowMs >= body.expiresAtMs ||
        typeof body.minimumFeeBps !== "string" || !/^\d+(?:\.\d{1,6})?$/u.test(body.minimumFeeBps) || !Number.isFinite(Number(body.minimumFeeBps)))
        refuse("funding_fee_age_rate");
    const [whole, fraction = ""] = body.minimumFeeBps.split("."), denominator = 10n ** BigInt(fraction.length) * 10000n;
    const fee = (BigInt(binding.amountAtomic) * BigInt(`${whole}${fraction}`) + denominator - 1n) / denominator;
    if (uint(body.quotedFeeAtomic) !== fee || fee > BigInt(binding.maxFeeAtomic) || BigInt(binding.amountAtomic) - fee < BigInt(binding.minMintAtomic))
        refuse("funding_fee_cap_or_net_floor");
    return Object.freeze({ ...body, integrityHash });
}
export function sealCircleFundingIntent(binding, feeQuote, deploymentDigest, preparedAtMs) {
    time(preparedAtMs);
    const b = validateCircleFundingBinding(binding), fee = assertCircleFundingFee(b, feeQuote, preparedAtMs);
    const body = { schemaVersion: "apn.circle-v2-evm-operation-intent.v2", operationSchemaVersion: CIRCLE_FUNDING_OPERATION_V2,
        binding: b, feeQuote: fee, deploymentDigest: hash(deploymentDigest), preparedAt: new Date(preparedAtMs).toISOString(), expiresAt: new Date(preparedAtMs + 15 * 60_000).toISOString() };
    return Object.freeze({ ...body, integrityHash: hashObject(body) });
}
export function validateCircleFundingIntent(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationSchemaVersion", "binding", "feeQuote", "deploymentDigest", "preparedAt", "expiresAt", "integrityHash"]) ||
        typeof value.preparedAt !== "string" || typeof value.expiresAt !== "string")
        refuse("funding_intent_shape");
    const expected = sealCircleFundingIntent(value.binding, value.feeQuote, String(value.deploymentDigest), Date.parse(value.preparedAt));
    if (hashObject(value) !== hashObject(expected))
        refuse("funding_intent_changed");
    return expected;
}
/** Evaluate fresh inputs using the normal owner registry. This returns metadata, never a reservation or grant. */
export function admitCircleFundingAssets(bindingValue, input) {
    const b = validateCircleFundingBinding(bindingValue), route = circleRoute(b.destinationChain, b.destinationProfile);
    time(input.nowMs);
    const s = input.source, d = input.destination;
    if (s.chainId !== b.sourceChain || s.address !== b.sourceOwner || uint(s.usdcBalanceAtomic) < BigInt(b.amountAtomic) ||
        uint(s.nativeBalanceAtomic) < 75000000000000n || uint(s.allowanceAtomic) !== 0n || uint(s.latestNonceAtomic) !== uint(s.pendingNonceAtomic) ||
        d.chainId !== b.destinationChain || d.address !== b.gasPayer || uint(d.nativeBalanceAtomic) < BigInt(route.destinationNativeCap) || uint(d.latestNonceAtomic) !== uint(d.pendingNonceAtomic))
        refuse("funding_accounts");
    const at = new Date(input.nowMs).toISOString();
    const admit = (registry, chain, asset, amountAtomic, usage) => {
        uint(usage);
        const result = evaluateAssetPolicy(registry, { chain: `eip155:${chain}`, asset, rail: "bridge", mechanism: b.mechanism,
            amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10), asOf: at });
        if (!bridgeMechanismAdmitted(result, b.mechanism) || result.asset.decimals !== (asset.kind === "token" ? 6 : 18))
            refuse("funding_policy_mechanism_or_decimals");
    };
    admit(input.sourceRegistry, 42161, { kind: "token", identifier: b.sourceToken }, b.amountAtomic, input.sourceTokenUsageAtomic);
    let nativeUsage = uint(input.sourceNativeUsageAtomic);
    for (const amount of ["30000000000000", "30000000000000", "15000000000000"]) {
        admit(input.sourceRegistry, 42161, { kind: "native", identifier: null }, amount, nativeUsage.toString());
        nativeUsage += BigInt(amount);
    }
    admit(input.destinationRegistry, b.destinationChain, { kind: "native", identifier: null }, route.destinationNativeCap, input.destinationNativeUsageAtomic);
}
//# sourceMappingURL=funding-binding.js.map