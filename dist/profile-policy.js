import { hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
export const PROFILE_POLICY_VERSION = "apn.profile-policy.v1";
const HASH = /^[a-f0-9]{64}$/u;
export function policyBinding(wallet) {
    if ("provider_id" in wallet) {
        return {
            profile: wallet.profile,
            profileHash: wallet.profile_hash,
            walletAddress: wallet.public_address,
            walletBindingHash: wallet.account_binding_hash,
        };
    }
    return {
        profile: wallet.profile,
        profileHash: wallet.profileHash,
        walletAddress: wallet.address,
        walletBindingHash: wallet.bindingHash,
    };
}
export function canonicalPolicyInput(input) {
    const maxBalanceUsdcAtomic = canonicalPositive(input.maxBalanceUsdcAtomic, "Base-USDC balance limit");
    const maxX402AmountAtomic = canonicalPositive(input.maxX402AmountAtomic, "per-x402 limit");
    const maxBalanceEthWei = input.maxBalanceEthWei === undefined
        ? undefined
        : canonicalPositive(input.maxBalanceEthWei, "Base-ETH balance limit");
    if (BigInt(maxX402AmountAtomic) > BigInt(maxBalanceUsdcAtomic)) {
        throw new ApnError("APN_INVALID_INPUT", "The per-x402 limit cannot exceed the Base-USDC balance limit.");
    }
    return {
        maxBalanceUsdcAtomic,
        maxX402AmountAtomic,
        ...(maxBalanceEthWei === undefined ? {} : { maxBalanceEthWei }),
    };
}
export function sealProfilePolicy(value) {
    return { ...value, integrityHash: hashObject(value) };
}
export function validateProfilePolicy(value, binding) {
    if (!isPlainRecord(value))
        corrupt("Profile policy is not an object.");
    const required = [
        "schemaVersion", "profile", "profileHash", "walletAddress", "walletBindingHash",
        "maxBalanceUsdcAtomic", "maxX402AmountAtomic", "approvedAt", "updatedAt", "integrityHash",
    ];
    const allowed = [...required, "maxBalanceEthWei"];
    if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.includes(key))) {
        corrupt("Profile policy has an unexpected schema.");
    }
    const policy = value;
    if (policy.schemaVersion !== PROFILE_POLICY_VERSION ||
        typeof policy.profile !== "string" || typeof policy.profileHash !== "string" || !HASH.test(policy.profileHash) ||
        typeof policy.walletAddress !== "string" || typeof policy.walletBindingHash !== "string" || !HASH.test(policy.walletBindingHash) ||
        typeof policy.approvedAt !== "string" || !canonicalTimestamp(policy.approvedAt) ||
        typeof policy.updatedAt !== "string" || !canonicalTimestamp(policy.updatedAt) ||
        policy.integrityHash !== hashObject(withoutIntegrity(policy)))
        corrupt("Profile policy integrity validation failed.");
    try {
        canonicalPolicyInput({
            maxBalanceUsdcAtomic: policy.maxBalanceUsdcAtomic,
            maxX402AmountAtomic: policy.maxX402AmountAtomic,
            ...(policy.maxBalanceEthWei === undefined ? {} : { maxBalanceEthWei: policy.maxBalanceEthWei }),
        });
    }
    catch {
        corrupt("Profile policy limits are invalid.");
    }
    if (Date.parse(policy.approvedAt) > Date.parse(policy.updatedAt)) {
        corrupt("Profile policy approval time is newer than its update time.");
    }
    if (binding !== undefined && (policy.profile !== binding.profile || policy.profileHash !== binding.profileHash ||
        policy.walletAddress !== binding.walletAddress || policy.walletBindingHash !== binding.walletBindingHash))
        corrupt("Profile policy does not bind the current wallet identity.");
    return policy;
}
export function publicProfilePolicy(profile, policy) {
    if (policy === null) {
        return {
            configured: false,
            policy_version: null,
            profile,
            limits: {
                max_balance_usdc_atomic: null,
                max_x402_amount_atomic: null,
                max_balance_eth_wei: null,
            },
            approved_at: null,
            updated_at: null,
            integrity_status: "not_present",
            proof_class: "encrypted_profile_policy_status",
            next_actions: ["apn wallet policy set"],
        };
    }
    return {
        configured: true,
        policy_version: policy.schemaVersion,
        profile: policy.profile,
        limits: {
            max_balance_usdc_atomic: policy.maxBalanceUsdcAtomic,
            max_x402_amount_atomic: policy.maxX402AmountAtomic,
            max_balance_eth_wei: policy.maxBalanceEthWei ?? null,
        },
        approved_at: policy.approvedAt,
        updated_at: policy.updatedAt,
        integrity_status: "authenticated",
        proof_class: "encrypted_profile_policy_status",
        next_actions: [],
    };
}
export function fundingPosture(usdcAtomic, ethAtomic, policy) {
    const usdc = parseAtomic(usdcAtomic);
    const eth = parseAtomic(ethAtomic);
    if (policy === null) {
        return {
            classification: "policy_unconfigured",
            inbound_balance_capped_by_apn: false,
            assets: {
                base_usdc: { classification: "policy_unconfigured", configured_limit_atomic: null, excess_atomic: "0" },
                base_eth: { classification: "policy_unconfigured", configured_limit_wei: null, excess_wei: "0" },
            },
            reason: "wallet_policy_required",
            next_actions: ["Configure the profile policy before unattended x402."],
        };
    }
    const usdcLimit = BigInt(policy.maxBalanceUsdcAtomic);
    const usdcExcess = usdc > usdcLimit ? usdc - usdcLimit : 0n;
    const ethLimit = policy.maxBalanceEthWei === undefined ? undefined : BigInt(policy.maxBalanceEthWei);
    const ethExcess = ethLimit !== undefined && eth > ethLimit ? eth - ethLimit : 0n;
    const overfunded = usdcExcess > 0n || ethExcess > 0n;
    return {
        classification: overfunded ? "overfunded" : "within_limit",
        inbound_balance_capped_by_apn: false,
        assets: {
            base_usdc: {
                classification: usdcExcess > 0n ? "overfunded" : "within_limit",
                configured_limit_atomic: policy.maxBalanceUsdcAtomic,
                excess_atomic: usdcExcess.toString(),
            },
            base_eth: ethLimit === undefined ? {
                classification: "unassessed",
                configured_limit_wei: null,
                excess_wei: "0",
            } : {
                classification: ethExcess > 0n ? "overfunded" : "within_limit",
                configured_limit_wei: policy.maxBalanceEthWei,
                excess_wei: ethExcess.toString(),
            },
        },
        reason: overfunded ? "local_disposable_balance_overfunded" : "local_disposable_balance_within_limit",
        next_actions: overfunded
            ? ["Reduce excess manually only to an independently verified address; APN does not sweep or refund automatically."]
            : [],
    };
}
export function requireProfilePolicy(policy) {
    if (policy === null) {
        throw new ApnError("APN_WALLET_POLICY_REQUIRED", "Configure the encrypted profile policy before unattended x402.");
    }
    return policy;
}
export function effectiveX402Cap(policy, callerCapInput) {
    if (callerCapInput === undefined)
        return policy.maxX402AmountAtomic;
    const callerCap = canonicalPositive(callerCapInput, "per-call x402 limit");
    if (BigInt(callerCap) > BigInt(policy.maxX402AmountAtomic)) {
        throw new ApnError("APN_X402_PROFILE_LIMIT_EXCEEDED", "The per-call x402 limit cannot exceed the owner-approved profile maximum.");
    }
    return callerCap;
}
export function assertUnattendedX402Balance(policy, usdcAtomic) {
    const balance = parseAtomic(usdcAtomic);
    if (balance > BigInt(policy.maxBalanceUsdcAtomic)) {
        throw new ApnError("APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402", "The disposable wallet exceeds its owner-approved Base-USDC balance limit; unattended x402 is blocked.");
    }
}
export function policyIncrease(current, next) {
    if (current === null)
        return true;
    if (BigInt(next.maxBalanceUsdcAtomic) > BigInt(current.maxBalanceUsdcAtomic))
        return true;
    if (BigInt(next.maxX402AmountAtomic) > BigInt(current.maxX402AmountAtomic))
        return true;
    if (next.maxBalanceEthWei === undefined)
        return false;
    return current.maxBalanceEthWei === undefined || BigInt(next.maxBalanceEthWei) > BigInt(current.maxBalanceEthWei);
}
function canonicalPositive(value, label) {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
        throw new ApnError("APN_INVALID_INPUT", `${label} must be a positive canonical integer.`);
    }
    return parseAtomic(value, { positive: true }).toString();
}
function canonicalTimestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function withoutIntegrity(value) {
    const { integrityHash: _ignored, ...rest } = value;
    return rest;
}
function corrupt(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
//# sourceMappingURL=profile-policy.js.map