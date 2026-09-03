import { exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import type { Address, WalletRecord } from "./model.js";

export const PROVIDER_PROFILE_VERSION = "apn.provider-profile.v1" as const;
export const PROVIDER_CAPABILITY_VERSION = "apn.provider-capability.v1" as const;
export const LOCAL_PROVIDER_ID = "local" as const;

export type ProviderTrustClass =
  | "local_software_wallet"
  | "provider_managed_non_custodial_tee"
  | "provider_managed_non_custodial_signer"
  | "external_owner_delegated_local_session";
export type DirectExecutionMode =
  | "local_raw_transaction_apn_submit"
  | "provider_atomic_send"
  | "delegated_session_transaction";
export type X402ExecutionMode =
  | "local_detached_eip3009_apn_paid_retry"
  | "provider_detached_eip3009_apn_paid_retry"
  | "provider_atomic_paid_fetch"
  | "delegated_erc7710_apn_paid_retry";
export type ProviderProfileState = "bound" | "drift_blocked" | "rebind_pending";

export interface ProviderPermissionCapability {
  readonly available: true;
  readonly protocol: "erc7715";
  readonly consent: "foreground_browser";
  readonly owner_custody: "external_metamask";
  readonly session_custody: "encrypted_local_apn";
  readonly provider_revoke: "unavailable_unproved";
}

export interface ProviderCapabilitySnapshot {
  readonly schema_version: typeof PROVIDER_CAPABILITY_VERSION;
  readonly network: { readonly caip2: typeof CHAIN_CAIP2; readonly chain: "base" };
  readonly asset: {
    readonly symbol: "USDC";
    readonly contract: typeof BASE_USDC;
    readonly decimals: typeof USDC_DECIMALS;
  };
  readonly lifecycle: { readonly connect: boolean; readonly status: boolean; readonly logout: boolean };
  readonly read: { readonly address: boolean; readonly balance: boolean; readonly funding_guidance: boolean };
  readonly direct: {
    readonly available: boolean;
    readonly mode: DirectExecutionMode;
    readonly execution_owner: "apn" | "provider";
    readonly retry_owner: "apn_operation_state" | "apn_outer_no_replay_journal";
  };
  readonly x402: {
    readonly available: boolean;
    readonly mode: X402ExecutionMode;
    readonly execution_owner: "apn" | "provider";
    readonly retry_owner: "apn_state_machine" | "apn_outer_no_replay_journal";
  };
  readonly evidence: { readonly available: boolean; readonly owner: "apn" | "provider" };
  readonly permission?: ProviderPermissionCapability;
}

export interface ProviderDrift {
  readonly state: ProviderProfileState;
  readonly reason: "none" | "identity_changed" | "capability_changed" | "identity_and_capability_changed";
  readonly observed_address?: Address;
  readonly observed_account_binding_hash?: string;
  readonly observed_capability_hash?: string;
  readonly observed_at?: string;
}

export interface ProviderProfileRecord {
  readonly schema_version: typeof PROVIDER_PROFILE_VERSION;
  readonly profile: string;
  readonly profile_hash: string;
  readonly provider_id: string;
  readonly public_address: Address;
  readonly account_binding_hash: string;
  readonly trust_class: ProviderTrustClass;
  readonly revision: number;
  readonly capability_snapshot: ProviderCapabilitySnapshot;
  readonly capability_hash: string;
  readonly observed_at: string;
  readonly drift: ProviderDrift;
}

export interface ProviderBindingObservation {
  readonly address: Address;
  readonly accountBindingHash: string;
  readonly capabilityHash: string;
  readonly observedAt: string;
  readonly trustClass: ProviderTrustClass;
}

export function localCapabilitySnapshot(): ProviderCapabilitySnapshot {
  return {
    schema_version: PROVIDER_CAPABILITY_VERSION,
    network: { caip2: CHAIN_CAIP2, chain: "base" },
    asset: { symbol: "USDC", contract: BASE_USDC, decimals: USDC_DECIMALS },
    lifecycle: { connect: false, status: true, logout: false },
    read: { address: true, balance: true, funding_guidance: true },
    direct: {
      available: true,
      mode: "local_raw_transaction_apn_submit",
      execution_owner: "apn",
      retry_owner: "apn_operation_state",
    },
    x402: {
      available: true,
      mode: "local_detached_eip3009_apn_paid_retry",
      execution_owner: "apn",
      retry_owner: "apn_state_machine",
    },
    evidence: { available: true, owner: "apn" },
  };
}

export function lifecycleReadOnlyCapabilitySnapshot(): ProviderCapabilitySnapshot {
  return {
    schema_version: PROVIDER_CAPABILITY_VERSION,
    network: { caip2: CHAIN_CAIP2, chain: "base" },
    asset: { symbol: "USDC", contract: BASE_USDC, decimals: USDC_DECIMALS },
    lifecycle: { connect: true, status: true, logout: true },
    read: { address: true, balance: true, funding_guidance: true },
    direct: {
      available: false,
      mode: "provider_atomic_send",
      execution_owner: "provider",
      retry_owner: "apn_outer_no_replay_journal",
    },
    x402: {
      available: false,
      mode: "provider_atomic_paid_fetch",
      execution_owner: "provider",
      retry_owner: "apn_outer_no_replay_journal",
    },
    evidence: { available: false, owner: "provider" },
  };
}

export function coinbaseDirectCapabilitySnapshot(): ProviderCapabilitySnapshot {
  const snapshot = lifecycleReadOnlyCapabilitySnapshot();
  return {
    ...snapshot,
    direct: {
      available: true,
      mode: "provider_atomic_send",
      execution_owner: "provider",
      retry_owner: "apn_outer_no_replay_journal",
    },
    x402: {
      available: true,
      mode: "provider_atomic_paid_fetch",
      execution_owner: "provider",
      retry_owner: "apn_outer_no_replay_journal",
    },
    evidence: { available: true, owner: "apn" },
  };
}

export function metamaskReadOnlyCapabilitySnapshot(): ProviderCapabilitySnapshot {
  return lifecycleReadOnlyCapabilitySnapshot();
}

export function metamaskDirectCapabilitySnapshot(): ProviderCapabilitySnapshot {
  const snapshot = lifecycleReadOnlyCapabilitySnapshot();
  return {
    ...snapshot,
    direct: {
      available: true,
      mode: "provider_atomic_send",
      execution_owner: "provider",
      retry_owner: "apn_outer_no_replay_journal",
    },
    x402: {
      available: true,
      mode: "provider_detached_eip3009_apn_paid_retry",
      execution_owner: "apn",
      retry_owner: "apn_state_machine",
    },
    evidence: { available: true, owner: "apn" },
  };
}

export function metamaskSmartAccountLegacyCapabilitySnapshot(): ProviderCapabilitySnapshot {
  const snapshot = lifecycleReadOnlyCapabilitySnapshot();
  return {
    ...snapshot,
    direct: {
      available: false,
      mode: "delegated_session_transaction",
      execution_owner: "apn",
      retry_owner: "apn_operation_state",
    },
    x402: {
      available: false,
      mode: "delegated_erc7710_apn_paid_retry",
      execution_owner: "apn",
      retry_owner: "apn_state_machine",
    },
    evidence: { available: false, owner: "apn" },
    permission: {
      available: true,
      protocol: "erc7715",
      consent: "foreground_browser",
      owner_custody: "external_metamask",
      session_custody: "encrypted_local_apn",
      provider_revoke: "unavailable_unproved",
    },
  };
}

export function metamaskSmartAccountCapabilitySnapshot(): ProviderCapabilitySnapshot {
  const snapshot = metamaskSmartAccountLegacyCapabilitySnapshot();
  return {
    ...snapshot,
    direct: {
      available: true,
      mode: "delegated_session_transaction",
      execution_owner: "apn",
      retry_owner: "apn_operation_state",
    },
    evidence: { available: true, owner: "apn" },
  };
}

export function capabilityHash(snapshot: ProviderCapabilitySnapshot): string {
  assertCapabilitySnapshot(snapshot);
  return hashObject(snapshot);
}

export function accountBindingHash(providerId: string, address: Address): string {
  return sha256(`provider-account-binding\0${providerId}\0${address.toLowerCase()}`);
}

export function markProviderProfileDrift(
  profile: ProviderProfileRecord,
  observed: ProviderBindingObservation,
): ProviderProfileRecord {
  const identityChanged = profile.public_address.toLowerCase() !== observed.address.toLowerCase() ||
    profile.account_binding_hash !== observed.accountBindingHash;
  const capabilityChanged = profile.capability_hash !== observed.capabilityHash ||
    profile.trust_class !== observed.trustClass;
  return {
    ...profile,
    drift: {
      state: "drift_blocked",
      reason: identityChanged && capabilityChanged ? "identity_and_capability_changed"
        : identityChanged ? "identity_changed" : "capability_changed",
      observed_address: observed.address,
      observed_account_binding_hash: observed.accountBindingHash,
      observed_capability_hash: observed.capabilityHash,
      observed_at: observed.observedAt,
    },
  };
}

export function projectLegacyLocalProfile(wallet: WalletRecord): ProviderProfileRecord {
  const snapshot = localCapabilitySnapshot();
  return {
    schema_version: PROVIDER_PROFILE_VERSION,
    profile: wallet.profile,
    profile_hash: wallet.profileHash,
    provider_id: LOCAL_PROVIDER_ID,
    public_address: wallet.address,
    account_binding_hash: wallet.bindingHash,
    trust_class: "local_software_wallet",
    revision: 1,
    capability_snapshot: snapshot,
    capability_hash: capabilityHash(snapshot),
    observed_at: wallet.createdAt,
    drift: { state: "bound", reason: "none" },
  };
}

export function validateProviderProfile(value: unknown): ProviderProfileRecord {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "schema_version", "profile", "profile_hash", "provider_id", "public_address", "account_binding_hash",
    "trust_class", "revision", "capability_snapshot", "capability_hash", "observed_at", "drift",
  ])) invalidProfile();
  const profile = value as unknown as ProviderProfileRecord;
  if (
    profile.schema_version !== PROVIDER_PROFILE_VERSION ||
    typeof profile.profile !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(profile.profile) ||
    typeof profile.profile_hash !== "string" || !/^[a-f0-9]{64}$/u.test(profile.profile_hash) ||
    profile.profile_hash !== sha256(`profile\0${profile.profile}`) ||
    typeof profile.provider_id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(profile.provider_id) ||
    typeof profile.public_address !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(profile.public_address) ||
    typeof profile.account_binding_hash !== "string" || !/^[a-f0-9]{64}$/u.test(profile.account_binding_hash) ||
    ![
      "local_software_wallet",
      "provider_managed_non_custodial_tee",
      "provider_managed_non_custodial_signer",
      "external_owner_delegated_local_session",
    ].includes(profile.trust_class) ||
    !Number.isSafeInteger(profile.revision) || profile.revision < 1 ||
    typeof profile.capability_hash !== "string" || !/^[a-f0-9]{64}$/u.test(profile.capability_hash) ||
    profile.capability_hash !== capabilityHash(profile.capability_snapshot) ||
    !isCanonicalTimestamp(profile.observed_at)
  ) invalidProfile();
  assertDrift(profile.drift);
  if ((profile.provider_id === LOCAL_PROVIDER_ID) !== (profile.trust_class === "local_software_wallet")) invalidProfile();
  return profile;
}

function assertCapabilitySnapshot(snapshot: ProviderCapabilitySnapshot): void {
  if (!isPlainRecord(snapshot) || !exactKeys(snapshot, [
    "schema_version", "network", "asset", "lifecycle", "read", "direct", "x402", "evidence",
    ...(snapshot.permission === undefined ? [] : ["permission"]),
  ]) || snapshot.schema_version !== PROVIDER_CAPABILITY_VERSION) invalidProfile();
  if (
    snapshot.network?.caip2 !== CHAIN_CAIP2 || snapshot.network.chain !== "base" ||
    snapshot.asset?.symbol !== "USDC" || snapshot.asset.contract !== BASE_USDC || snapshot.asset.decimals !== USDC_DECIMALS ||
    !isPlainRecord(snapshot.lifecycle) || !isPlainRecord(snapshot.read) || !isPlainRecord(snapshot.direct) ||
    !isPlainRecord(snapshot.x402) || !isPlainRecord(snapshot.evidence)
  ) invalidProfile();
  if (
    !exactKeys(snapshot.network, ["caip2", "chain"]) || !exactKeys(snapshot.asset, ["symbol", "contract", "decimals"]) ||
    !exactKeys(snapshot.lifecycle, ["connect", "status", "logout"]) ||
    !exactKeys(snapshot.read, ["address", "balance", "funding_guidance"]) ||
    !exactKeys(snapshot.direct, ["available", "mode", "execution_owner", "retry_owner"]) ||
    !exactKeys(snapshot.x402, ["available", "mode", "execution_owner", "retry_owner"]) ||
    !exactKeys(snapshot.evidence, ["available", "owner"])
  ) invalidProfile();
  for (const value of [
    snapshot.lifecycle.connect, snapshot.lifecycle.status, snapshot.lifecycle.logout,
    snapshot.read.address, snapshot.read.balance, snapshot.read.funding_guidance,
    snapshot.direct.available, snapshot.x402.available, snapshot.evidence.available,
  ]) if (typeof value !== "boolean") invalidProfile();
  if (!new Set<DirectExecutionMode>([
    "local_raw_transaction_apn_submit", "provider_atomic_send", "delegated_session_transaction",
  ]).has(snapshot.direct.mode)) invalidProfile();
  if (!new Set<X402ExecutionMode>([
    "local_detached_eip3009_apn_paid_retry",
    "provider_detached_eip3009_apn_paid_retry",
    "provider_atomic_paid_fetch",
    "delegated_erc7710_apn_paid_retry",
  ]).has(snapshot.x402.mode)) invalidProfile();
  if (
    !["apn", "provider"].includes(snapshot.direct.execution_owner) ||
    !["apn_operation_state", "apn_outer_no_replay_journal"].includes(snapshot.direct.retry_owner) ||
    !["apn", "provider"].includes(snapshot.x402.execution_owner) ||
    !["apn_state_machine", "apn_outer_no_replay_journal"].includes(snapshot.x402.retry_owner) ||
    !["apn", "provider"].includes(snapshot.evidence.owner)
  ) invalidProfile();
  const directApnOwned = snapshot.direct.mode !== "provider_atomic_send";
  const x402ApnOwned = snapshot.x402.mode !== "provider_atomic_paid_fetch";
  if (
    directApnOwned !== (snapshot.direct.execution_owner === "apn" && snapshot.direct.retry_owner === "apn_operation_state") ||
    x402ApnOwned !== (snapshot.x402.execution_owner === "apn" && snapshot.x402.retry_owner === "apn_state_machine")
  ) invalidProfile();
  if (snapshot.permission !== undefined && (
    !isPlainRecord(snapshot.permission) || !exactKeys(snapshot.permission, [
      "available", "protocol", "consent", "owner_custody", "session_custody", "provider_revoke",
    ]) || snapshot.permission.available !== true || snapshot.permission.protocol !== "erc7715" ||
    snapshot.permission.consent !== "foreground_browser" || snapshot.permission.owner_custody !== "external_metamask" ||
    snapshot.permission.session_custody !== "encrypted_local_apn" ||
    snapshot.permission.provider_revoke !== "unavailable_unproved"
  )) invalidProfile();
}

function assertDrift(drift: ProviderDrift): void {
  if (!isPlainRecord(drift) || !["bound", "drift_blocked", "rebind_pending"].includes(drift.state)) invalidProfile();
  const expectedKeys = drift.state === "bound"
    ? ["state", "reason"]
    : ["state", "reason", "observed_address", "observed_account_binding_hash", "observed_capability_hash", "observed_at"];
  if (!exactKeys(drift, expectedKeys)) invalidProfile();
  if (![
    "none", "identity_changed", "capability_changed", "identity_and_capability_changed",
  ].includes(drift.reason)) invalidProfile();
  if ((drift.state === "bound") !== (drift.reason === "none")) invalidProfile();
  for (const hash of [drift.observed_account_binding_hash, drift.observed_capability_hash]) {
    if (hash !== undefined && !/^[a-f0-9]{64}$/u.test(hash)) invalidProfile();
  }
  if (drift.observed_address !== undefined && !/^0x[0-9a-fA-F]{40}$/u.test(drift.observed_address)) invalidProfile();
  if (drift.observed_at !== undefined && !isCanonicalTimestamp(drift.observed_at)) invalidProfile();
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function invalidProfile(): never {
  throw new ApnError("APN_STATE_CORRUPT", "Provider profile state is invalid.");
}
