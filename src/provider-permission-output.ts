import { capabilityHash } from "./provider-profile.js";
import type {
  ProviderAdapterBundle,
  ProviderPendingPermissionBinding,
  ProviderPermissionBinding,
} from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";

export function publicPendingPermissionProfile(
  profile: string,
  adapter: ProviderAdapterBundle,
  permission: ProviderPendingPermissionBinding,
): unknown {
  return {
    profile,
    provider: adapter.provider_id,
    status: "pending_consent",
    trust_class: adapter.trust_class,
    revision: permission.revision,
    capability_hash: capabilityHash(adapter.capabilities),
    capabilities: adapter.capabilities,
    observed_at: permission.observed_at,
    reused: true,
    proof_class: "provider_permission_pending_local_state",
    permission: {
      protocol: "erc7715",
      owner_smart_account: "unconfirmed",
      session_account: permission.session_address,
      requested_cap_usdc_atomic: permission.requested_cap_atomic,
      starts_at_unix: permission.starts_at_unix,
      expires_at_unix: permission.expires_at_unix,
      state: "pending_consent",
      revision: permission.revision,
      revocation_freshness: permission.revocation_freshness,
      owner_custody: "external_metamask_unconfirmed",
      session_custody: "encrypted_local_apn",
      provider_revoke: "unavailable_unproved",
    },
    warning: "The local consent intent is pending. MetaMask-side authority may already exist after a timeout; review it before replacing the intent.",
    next_actions: [
      "Retry wallet connect with the exact original provider, cap, expiry and idempotency key to reuse this session.",
      `After reviewing MetaMask, cancel only the local pending intent with apn wallet permission forget --profile ${profile} --expected-revision ${permission.revision}.`,
    ],
  };
}

export function publicPermissionProfile(
  profile: ProviderProfileRecord,
  permission: ProviderPermissionBinding,
  reused: boolean,
): unknown {
  const state = profile.drift.state === "bound" ? permission.state : "drift_blocked";
  return {
    profile: profile.profile,
    provider: profile.provider_id,
    status: state,
    address: permission.owner_address,
    account_binding_hash: profile.account_binding_hash,
    trust_class: profile.trust_class,
    revision: profile.revision,
    capability_hash: profile.capability_hash,
    capabilities: profile.capability_snapshot,
    observed_at: permission.observed_at,
    reused,
    proof_class: "provider_permission_binding",
    permission: {
      protocol: "erc7715",
      owner_smart_account: permission.owner_address,
      session_account: permission.session_address,
      requested_cap_usdc_atomic: permission.requested_cap_atomic,
      granted_cap_usdc_atomic: permission.granted_cap_atomic,
      starts_at_unix: permission.starts_at_unix,
      expires_at_unix: permission.expires_at_unix,
      state,
      revision: permission.revision,
      grant_fingerprint: permission.grant_fingerprint,
      revocation_freshness: permission.revocation_freshness,
      ...(permission.last_foreground_sync_at === undefined ? {} : {
        last_foreground_sync_at: permission.last_foreground_sync_at,
      }),
      owner_custody: "external_metamask",
      session_custody: "encrypted_local_apn",
      provider_revoke: "unavailable_unproved",
    },
    ...(state === "active" ? { funding_guidance: {
      network: "Base",
      asset: "USDC",
      address: permission.owner_address,
      action: "Fund the owner Smart Account manually only; APN performs no funding action.",
      session_gas_address: permission.session_address,
    } } : {}),
    next_actions: permissionNextActions(profile.profile, profile.revision, { ...permission, state }),
  };
}

function permissionNextActions(profile: string, profileRevision: number, permission: ProviderPermissionBinding): readonly string[] {
  if (permission.state === "active") {
    return [
      `Use apn wallet balance --profile ${profile} with an explicit Base RPC URL`,
      `Use apn wallet permission sync --profile ${profile} --expected-revision ${profileRevision} for foreground provider freshness`,
    ];
  }
  if (permission.state === "disabled") {
    return ["Create a new profile and foreground permission identity to regain authority."];
  }
  if (permission.state === "expired") {
    return ["Create a new profile and foreground permission identity with a new explicit expiry."];
  }
  if (permission.state === "revoked") {
    return ["Create a new profile and foreground permission identity after reviewing MetaMask grants."];
  }
  return ["Review the selected MetaMask account and permission, then create a new foreground identity."];
}
