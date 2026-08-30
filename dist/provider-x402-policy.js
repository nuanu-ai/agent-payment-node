import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import { assertUnattendedX402Balance, } from "./profile-policy.js";
const PROVIDER_AMOUNT_MAX = 9007199254740991n;
export function soleProviderOffer(challenge) {
    if (challenge.staticCandidates.length !== 1) {
        throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "Coinbase x402 requires exactly one eligible Base-USDC exact offer.");
    }
    const candidate = challenge.staticCandidates[0];
    const requirements = candidate === undefined ? undefined : challenge.paymentRequired.accepts[Number(candidate.index)];
    if (candidate === undefined || requirements === undefined)
        throw new ApnError("APN_HTTP_PROTOCOL", "Selected seller offer is missing.");
    return {
        requirements,
        amountAtomic: candidate.amountAtomic,
        payee: candidate.payTo,
        digest: candidate.offerHash,
    };
}
export function freezeProviderPolicy(policy, callerCapAtomic, effectiveCapAtomic) {
    return {
        schemaVersion: policy.schemaVersion,
        integrityHash: policy.integrityHash,
        updatedAt: policy.updatedAt,
        walletBindingHash: policy.walletBindingHash,
        maxBalanceUsdcAtomic: policy.maxBalanceUsdcAtomic,
        maxX402AmountAtomic: policy.maxX402AmountAtomic,
        ...(callerCapAtomic === undefined ? {} : { callerCapAtomic }),
        effectiveCapAtomic,
        verdict: "authorized_by_existing_profile_policy",
    };
}
export function assertProviderPolicyBalance(policy, balance, amountAtomic) {
    assertUnattendedX402Balance(policy, balance.raw);
    if (BigInt(balance.raw) < BigInt(amountAtomic))
        throw new ApnError("APN_INSUFFICIENT_USDC", "Provider Base-USDC balance is insufficient.");
}
export function assertProviderAtomicAmount(value) {
    if (!/^[1-9][0-9]*$/u.test(value))
        throw new ApnError("APN_PROVIDER_PROTOCOL", "Provider x402 amount is not canonical.");
    const amount = BigInt(value);
    if (amount < 1n || amount > PROVIDER_AMOUNT_MAX || !Number.isSafeInteger(Number(amount)) || BigInt(Number(amount)) !== amount) {
        throw new ApnError("APN_PROVIDER_PROTOCOL", "The pinned provider cannot encode this exact x402 amount.");
    }
}
export function sameFrozenProviderProfile(profile, operation) {
    return profile.provider_id === operation.provider.providerId && profile.revision === operation.provider.profileRevision &&
        profile.capability_hash === operation.provider.capabilityHash &&
        profile.account_binding_hash === operation.provider.accountBindingHash &&
        profile.public_address.toLowerCase() === operation.provider.payer;
}
export function sameFrozenProviderPolicy(operation, policy, effectiveCap) {
    return canonicalJson(freezeProviderPolicy(policy, operation.policy.callerCapAtomic, effectiveCap)) === canonicalJson(operation.policy);
}
//# sourceMappingURL=provider-x402-policy.js.map