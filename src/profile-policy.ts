import { getAddress } from "viem";
import { canonicalJson, hashObject, isPlainRecord } from "./canonical.js";
import { releasedX402Pair, validPolicyNetwork, type X402Asset, type X402PolicyNetwork } from "./x402-network.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import type { Address, WalletRecord } from "./model.js";
import type { ProviderProfileRecord } from "./provider-profile.js";

export const PROFILE_POLICY_VERSION = "apn.profile-policy.v1" as const;

const HASH = /^[a-f0-9]{64}$/u;

export interface ProfilePolicyBinding {
  readonly x402Network?: X402PolicyNetwork;
  readonly profile: string;
  readonly profileHash: string;
  readonly walletAddress: Address;
  readonly walletBindingHash: string;
}

export interface ProfilePolicyRecord extends ProfilePolicyBinding {
  readonly schemaVersion: typeof PROFILE_POLICY_VERSION;
  readonly maxBalanceUsdcAtomic: string;
  readonly maxX402AmountAtomic: string;
  readonly maxBalanceEthWei?: string;
  /**
   * Optional owner payee pin for x402 (1-16 canonical non-zero EVM addresses). Absent means this policy does not restrict
   * payees: the payee stays the seller's offer, shown and bound into the authorization. Checked at prepare, before
   * signing and before the first paid request.
   */
  readonly x402Payees?: readonly Address[];
  readonly approvedAt: string;
  readonly updatedAt: string;
  readonly integrityHash: string;
}

export interface ProfilePolicySetInput {
  readonly maxBalanceUsdcAtomic: string;
  readonly maxX402AmountAtomic: string;
  readonly maxBalanceEthWei?: string;
  /** Omitted keeps the current pin; null removes it (payees not restricted); a list sets it. */
  readonly x402Payees?: readonly string[] | null;
}

export const MAX_X402_PAYEES = 16;
/** CLI spelling that removes the pin (`--x402-payees unrestricted`). */
export const X402_PAYEES_UNRESTRICTED = "unrestricted";
/** The canonical pin a request sets: null when it removes the pin. */
export function canonicalX402Payees(value: readonly string[] | null): readonly Address[] | null {
  return value === null ? null : x402PayeeList(value);
}
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** 1-16 unique non-zero EVM addresses in checksum form, or null when the list is invalid. `exact` refuses other spellings. */
export function x402PayeeList(value: unknown, exact = false): readonly Address[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_X402_PAYEES) return null;
  const out: Address[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(entry)) return null;
    let address: Address;
    try { address = getAddress(entry) as Address; } catch { return null; }
    if (address === ZERO_ADDRESS || out.includes(address) || exact && address !== entry) return null;
    out.push(address);
  }
  return out;
}

/** Seller offers whose payee the optional pin admits (all of them without a pin); none admitted refuses before selection. */
export function x402PayeeAdmittedOffers<T extends { readonly payTo: string }>(policy: Pick<ProfilePolicyRecord, "x402Payees">, offers: readonly T[]): readonly T[] {
  const pinned = policy.x402Payees;
  if (pinned === undefined) return offers;
  const admitted = offers.filter((offer) => { try { return pinned.includes(getAddress(offer.payTo) as Address); } catch { return false; } });
  if (admitted.length === 0) {
    throw new ApnError("APN_OPERATION_BLOCKED", "The owner's x402 policy pins payees; no seller offer pays one of them.", { reason: "x402_payee_not_admitted" });
  }
  return admitted;
}
/** Refuse a payee outside the profile's optional x402 payee pin. Returns when admitted or when the policy has no pin. */
export function assertX402PayeeAdmitted(policy: Pick<ProfilePolicyRecord, "x402Payees">, payee: string): void {
  if (policy.x402Payees === undefined) return;
  let canonical: string | null = null;
  try { canonical = getAddress(payee); } catch { /* not an EVM payee */ }
  if (canonical === null || !policy.x402Payees.includes(canonical as Address)) {
    throw new ApnError("APN_OPERATION_BLOCKED", "The owner's x402 policy pins payees; this payee is not one of them.",
      { reason: "x402_payee_not_admitted", payee: String(payee) });
  }
}

export interface ProfilePolicyPort {
  load(binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null>;
  set(binding: ProfilePolicyBinding, input: ProfilePolicySetInput): Promise<ProfilePolicyRecord>;
}

export function policyBinding(wallet: WalletRecord | ProviderProfileRecord): ProfilePolicyBinding {
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

export function canonicalPolicyInput(input: ProfilePolicySetInput): ProfilePolicySetInput {
  const maxBalanceUsdcAtomic = canonicalPositive(input.maxBalanceUsdcAtomic, "selected-network USDC balance limit");
  const maxX402AmountAtomic = canonicalPositive(input.maxX402AmountAtomic, "per-x402 limit");
  const maxBalanceEthWei = input.maxBalanceEthWei === undefined
    ? undefined
    : canonicalPositive(input.maxBalanceEthWei, "selected-network ETH balance limit");
  const x402Payees = input.x402Payees === undefined || input.x402Payees === null ? input.x402Payees : x402PayeeList(input.x402Payees);
  if (x402Payees === null && input.x402Payees !== null) {
    throw new ApnError("APN_INVALID_INPUT", `The x402 payee pin must list 1 to ${MAX_X402_PAYEES} unique non-zero EVM addresses.`);
  }
  if (BigInt(maxX402AmountAtomic) > BigInt(maxBalanceUsdcAtomic)) {
    throw new ApnError("APN_INVALID_INPUT", "The per-x402 limit cannot exceed the selected-network USDC balance limit.");
  }
  return {
    maxBalanceUsdcAtomic,
    maxX402AmountAtomic,
    ...(maxBalanceEthWei === undefined ? {} : { maxBalanceEthWei }),
    ...(x402Payees === undefined ? {} : { x402Payees }),
  };
}

export function sealProfilePolicy(
  value: Omit<ProfilePolicyRecord, "integrityHash">,
): ProfilePolicyRecord {
  return { ...value, integrityHash: hashObject(value) };
}

export function validateProfilePolicy(value: unknown, binding?: ProfilePolicyBinding): ProfilePolicyRecord {
  if (!isPlainRecord(value)) corrupt("Profile policy is not an object.");
  const required = [
    "schemaVersion", "profile", "profileHash", "walletAddress", "walletBindingHash",
    "maxBalanceUsdcAtomic", "maxX402AmountAtomic", "approvedAt", "updatedAt", "integrityHash",
  ];
  const allowed = [...required, "maxBalanceEthWei", "x402Network", "x402Payees"];
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.includes(key))) {
    corrupt("Profile policy has an unexpected schema.");
  }
  const policy = value as unknown as ProfilePolicyRecord;
  if (
    policy.schemaVersion !== PROFILE_POLICY_VERSION || !validPolicyNetwork(policy.x402Network) ||
    typeof policy.profile !== "string" || typeof policy.profileHash !== "string" || !HASH.test(policy.profileHash) ||
    typeof policy.walletAddress !== "string" || typeof policy.walletBindingHash !== "string" || !HASH.test(policy.walletBindingHash) ||
    typeof policy.approvedAt !== "string" || !canonicalTimestamp(policy.approvedAt) ||
    typeof policy.updatedAt !== "string" || !canonicalTimestamp(policy.updatedAt) ||
    policy.integrityHash !== hashObject(withoutIntegrity(policy))
  ) corrupt("Profile policy integrity validation failed.");
  try {
    canonicalPolicyInput({
      maxBalanceUsdcAtomic: policy.maxBalanceUsdcAtomic,
      maxX402AmountAtomic: policy.maxX402AmountAtomic,
      ...(policy.maxBalanceEthWei === undefined ? {} : { maxBalanceEthWei: policy.maxBalanceEthWei }),
    });
  } catch {
    corrupt("Profile policy limits are invalid.");
  }
  if (policy.x402Payees !== undefined && x402PayeeList(policy.x402Payees, true) === null) {
    corrupt("Profile policy x402 payee pin is invalid.");
  }
  if (Date.parse(policy.approvedAt) > Date.parse(policy.updatedAt)) {
    corrupt("Profile policy approval time is newer than its update time.");
  }
  if (binding !== undefined && (
    policy.profile !== binding.profile || policy.profileHash !== binding.profileHash ||
    policy.walletAddress !== binding.walletAddress || policy.walletBindingHash !== binding.walletBindingHash ||
    canonicalJson(policy.x402Network ?? null) !== canonicalJson(binding.x402Network ?? null)
  )) corrupt("Profile policy does not bind the current wallet identity.");
  return policy;
}

/** `asset` is the network and token the caller named; omitted for the original Base USDC spelling. */
export function publicProfilePolicy(profile: string, policy: ProfilePolicyRecord | null, asset?: X402Asset): unknown {
  const selected = asset === undefined ? {} : { chain: asset.network, token: asset.token };
  if (policy === null) {
    return {
      configured: false,
      ...selected,
      policy_version: null,
      profile,
      limits: {
        max_balance_usdc_atomic: null,
        max_x402_amount_atomic: null,
        max_balance_eth_wei: null,
      },
      x402_payees: null,
      approved_at: null,
      updated_at: null,
      integrity_status: "not_present",
      proof_class: "encrypted_profile_policy_status",
      // The one manifest v2 command that sets this policy, for the profile, network and token just shown; the owner picks the limits.
      next_actions: [`apn wallet policy set --profile ${profile}${asset === undefined ? "" : ` --chain ${asset.network}${
        releasedX402Pair(asset.chainId, asset.token) ? "" : ` --asset ${asset.token}`}`} ` +
        "--max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>"],
    };
  }
  return {
    configured: true,
    ...selected,
    policy_version: policy.schemaVersion,
    profile: policy.profile,
    limits: {
      max_balance_usdc_atomic: policy.maxBalanceUsdcAtomic,
      max_x402_amount_atomic: policy.maxX402AmountAtomic,
      max_balance_eth_wei: policy.maxBalanceEthWei ?? null,
    },
    x402_payees: policy.x402Payees ?? null,
    approved_at: policy.approvedAt,
    updated_at: policy.updatedAt,
    integrity_status: "authenticated",
    proof_class: "encrypted_profile_policy_status",
    next_actions: [],
  };
}

export const REDUCE_EXCESS_ACTION = "Reduce excess manually only to an independently verified address; APN does not sweep or refund automatically.";

export interface FundingPosture {
  readonly classification: string;
  readonly next_actions: readonly string[];
  readonly [field: string]: unknown;
}

export function fundingPosture(
  usdcAtomic: string,
  ethAtomic: string,
  policy: ProfilePolicyRecord | null,
): FundingPosture {
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
      ? [REDUCE_EXCESS_ACTION]
      : [],
  };
}

export function requireProfilePolicy(policy: ProfilePolicyRecord | null): ProfilePolicyRecord {
  if (policy === null) {
    throw new ApnError("APN_WALLET_POLICY_REQUIRED", "Configure the encrypted profile policy before unattended x402.");
  }
  return policy;
}

export function effectiveX402Cap(policy: ProfilePolicyRecord, callerCapInput?: string): string {
  if (callerCapInput === undefined) return policy.maxX402AmountAtomic;
  const callerCap = canonicalPositive(callerCapInput, "per-call x402 limit");
  if (BigInt(callerCap) > BigInt(policy.maxX402AmountAtomic)) {
    throw new ApnError(
      "APN_X402_PROFILE_LIMIT_EXCEEDED",
      "The per-call x402 limit cannot exceed the owner-approved profile maximum.",
    );
  }
  return callerCap;
}

export function assertUnattendedX402Balance(policy: ProfilePolicyRecord, usdcAtomic: string): void {
  const balance = parseAtomic(usdcAtomic);
  if (balance > BigInt(policy.maxBalanceUsdcAtomic)) {
    throw new ApnError(
      "APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402",
      "The disposable wallet exceeds its owner-approved selected-network USDC balance limit; unattended x402 is blocked.",
    );
  }
}

export function policyIncrease(
  current: ProfilePolicyRecord | null,
  next: ProfilePolicySetInput,
): boolean {
  if (current === null) return true;
  if (BigInt(next.maxBalanceUsdcAtomic) > BigInt(current.maxBalanceUsdcAtomic)) return true;
  if (BigInt(next.maxX402AmountAtomic) > BigInt(current.maxX402AmountAtomic)) return true;
  // Removing the payee pin, or adding a payee to it, widens who may be paid; pinning where there was none narrows.
  const pinned = current.x402Payees;
  if (pinned !== undefined && (next.x402Payees === undefined || next.x402Payees === null || next.x402Payees.some((payee) => !pinned.includes(payee as Address)))) return true;
  if (next.maxBalanceEthWei === undefined) return false;
  return current.maxBalanceEthWei === undefined || BigInt(next.maxBalanceEthWei) > BigInt(current.maxBalanceEthWei);
}

function canonicalPositive(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new ApnError("APN_INVALID_INPUT", `${label} must be a positive canonical integer.`);
  }
  return parseAtomic(value, { positive: true }).toString();
}

function canonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function withoutIntegrity(value: ProfilePolicyRecord): Omit<ProfilePolicyRecord, "integrityHash"> {
  const { integrityHash: _ignored, ...rest } = value;
  return rest;
}

function corrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
