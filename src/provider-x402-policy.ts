import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import {
  assertUnattendedX402Balance,
  type ProfilePolicyRecord,
} from "./profile-policy.js";
import type { ProviderBalanceObservation } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { ProviderX402OperationRecord, ProviderX402PolicyBinding } from "./provider-x402-model.js";
import type { FreshChallenge } from "./x402-policy.js";

const PROVIDER_AMOUNT_MAX = 9_007_199_254_740_991n;

export function soleProviderOffer(challenge: FreshChallenge): {
  readonly requirements: FreshChallenge["paymentRequired"]["accepts"][number];
  readonly amountAtomic: string;
  readonly payee: `0x${string}`;
  readonly digest: string;
} {
  if (challenge.staticCandidates.length !== 1) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "Coinbase x402 requires exactly one eligible Base-USDC exact offer.");
  }
  const candidate = challenge.staticCandidates[0];
  const requirements = candidate === undefined ? undefined : challenge.paymentRequired.accepts[Number(candidate.index)];
  if (candidate === undefined || requirements === undefined) throw new ApnError("APN_HTTP_PROTOCOL", "Selected seller offer is missing.");
  return {
    requirements,
    amountAtomic: candidate.amountAtomic,
    payee: candidate.payTo as `0x${string}`,
    digest: candidate.offerHash,
  };
}

export function freezeProviderPolicy(
  policy: ProfilePolicyRecord,
  callerCapAtomic: string | undefined,
  effectiveCapAtomic: string,
): ProviderX402PolicyBinding {
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

export function assertProviderPolicyBalance(
  policy: ProfilePolicyRecord,
  balance: ProviderBalanceObservation,
  amountAtomic: string,
): void {
  assertUnattendedX402Balance(policy, balance.raw);
  if (BigInt(balance.raw) < BigInt(amountAtomic)) throw new ApnError("APN_INSUFFICIENT_USDC", "Provider Base-USDC balance is insufficient.");
}

export function assertProviderAtomicAmount(value: string): void {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new ApnError("APN_PROVIDER_PROTOCOL", "Provider x402 amount is not canonical.");
  const amount = BigInt(value);
  if (amount < 1n || amount > PROVIDER_AMOUNT_MAX || !Number.isSafeInteger(Number(amount)) || BigInt(Number(amount)) !== amount) {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "The pinned provider cannot encode this exact x402 amount.");
  }
}

export function sameFrozenProviderProfile(
  profile: ProviderProfileRecord,
  operation: ProviderX402OperationRecord,
): boolean {
  return profile.provider_id === operation.provider.providerId && profile.revision === operation.provider.profileRevision &&
    profile.capability_hash === operation.provider.capabilityHash &&
    profile.account_binding_hash === operation.provider.accountBindingHash &&
    profile.public_address.toLowerCase() === operation.provider.payer;
}

export function sameFrozenProviderPolicy(
  operation: ProviderX402OperationRecord,
  policy: ProfilePolicyRecord,
  effectiveCap: string,
): boolean {
  return canonicalJson(freezeProviderPolicy(policy, operation.policy.callerCapAtomic, effectiveCap)) === canonicalJson(operation.policy);
}
