import { capabilityHash } from "./provider-profile.js";
import type {
  ProviderAdapterBundle,
  ProviderPendingPermissionBinding,
  ProviderPermissionBinding,
} from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";

/**
 * What a pending consent intent allows next. While it is live: the exact retry, or cancelling it after a MetaMask review.
 * Once expired the exact connect is refused before consent, so only the review, the local cancel and a new intent remain
 * (QA 0.5.72). Forget removes only the local intent; MetaMask-side authority is reviewed and revoked there.
 */
export function pendingPermissionNextActions(profile: string, permission: ProviderPendingPermissionBinding, nowUnix: number): readonly string[] {
  const forget = `apn wallet permission forget --profile ${profile} --expected-revision ${permission.revision}`;
  if (nowUnix < permission.expires_at_unix) return [
    "Retry wallet connect with the exact original provider, cap, expiry and idempotency key to reuse this session.",
    `After reviewing MetaMask, cancel only the local pending intent with ${forget}.`,
  ];
  return [
    `The intent expired at ${new Date(permission.expires_at_unix * 1000).toISOString()} and its exact connect is refused. In MetaMask, check whether ` +
      `a permission for session ${permission.session_address} was granted, and revoke it there if it is not wanted.`,
    `Then cancel only the local expired intent with ${forget}, and start a new wallet connect with a new expiry and idempotency key.`,
  ];
}

export function publicPendingPermissionProfile(
  profile: string,
  adapter: ProviderAdapterBundle,
  permission: ProviderPendingPermissionBinding,
  nowUnix: number,
): unknown {
  const expired = nowUnix >= permission.expires_at_unix;
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
      expired,
      state: "pending_consent",
      revision: permission.revision,
      revocation_freshness: permission.revocation_freshness,
      owner_custody: "external_metamask_unconfirmed",
      session_custody: "encrypted_local_apn",
      provider_revoke: "unavailable_unproved",
    },
    warning: expired
      ? "The local consent intent expired before consent was confirmed. MetaMask-side authority may still exist if consent finished after a timeout; review it before replacing the intent."
      : "The local consent intent is pending. MetaMask-side authority may already exist after a timeout; review it before replacing the intent.",
    next_actions: pendingPermissionNextActions(profile, permission, nowUnix),
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
