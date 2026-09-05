import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { Address, Hex } from "./model.js";
import {
  assertSmartAccountPreflight,
  validateSmartAccountObservation,
  type SmartAccountPermissionRequestShape,
} from "./metamask-smart-account-grant.js";
import { assertMetaMaskSmartAccountPackageIdentity } from "./metamask-smart-account-package.js";
import {
  isGrantedPermissionRecord,
  METAMASK_SMART_ACCOUNT_PROVIDER_ID,
  projectPendingPermissionBinding,
  projectPermissionBinding,
  SMART_ACCOUNT_PERMISSION_RECORD_VERSION,
  type GrantedSmartAccountPermissionRecord,
  type PendingSmartAccountPermissionRecord,
  type SmartAccountPermissionRecord,
} from "./metamask-smart-account-record.js";
import type { SmartAccountConsentPort } from "./metamask-smart-account-consent.js";
import type { SmartAccountPermissionStorePort } from "./encrypted-smart-account-permission-store.js";
import type {
  DirectExecutionPort,
  ProviderAdapterBundle,
  ProviderPermissionBinding,
  ProviderPermissionConnectIntent,
  ProviderPermissionLifecyclePort,
  ProviderPendingPermissionBinding,
  X402PaymentMaterialPort,
} from "./provider-ports.js";
import {
  accountBindingHash,
  capabilityHash,
  metamaskSmartAccountCapabilitySnapshot,
  metamaskSmartAccountLegacyCapabilitySnapshot,
  metamaskSmartAccountX402CapabilitySnapshot,
  type ProviderProfileRecord,
} from "./provider-profile.js";

export { METAMASK_SMART_ACCOUNT_PROVIDER_ID } from "./metamask-smart-account-record.js";

export interface SessionKeyFactoryPort {
  create(): { readonly address: Address; readonly privateKey: Hex };
}

export class LocalSessionKeyFactory implements SessionKeyFactoryPort {
  create(): { readonly address: Address; readonly privateKey: Hex } {
    const privateKey = generatePrivateKey();
    return { address: privateKeyToAccount(privateKey).address, privateKey };
  }
}

export class MetaMaskSmartAccountAdapter implements ProviderPermissionLifecyclePort {
  readonly capabilities = metamaskSmartAccountX402CapabilitySnapshot();

  constructor(
    private readonly store: SmartAccountPermissionStorePort,
    private readonly consent: SmartAccountConsentPort,
    private readonly sessionKeys: SessionKeyFactoryPort = new LocalSessionKeyFactory(),
    private readonly now: () => Date = () => new Date(),
    private readonly direct: DirectExecutionPort = unavailableDirectExecution(),
    private readonly x402Material: X402PaymentMaterialPort = unavailableX402Material(),
  ) {}

  bundle(): ProviderAdapterBundle {
    return {
      provider_id: METAMASK_SMART_ACCOUNT_PROVIDER_ID,
      trust_class: "external_owner_delegated_local_session",
      capabilities: this.capabilities,
      lifecycle: {
        authenticationMethods: ["browser"],
        connect: async () => unsupportedInternalPath(),
        probeStatus: async () => undefined,
        logout: async () => { throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "Use wallet permission forget for this local Smart Account profile."); },
      },
      reads: {
        observeBalance: async () => unsupportedInternalPath(),
        crossCheckAddress: async () => unsupportedInternalPath(),
      },
      direct: this.direct,
      x402Material: this.x402Material,
      permissions: this,
      profileMigration: { upgrade: async (profile) => await this.upgradeProfile(profile) },
    };
  }

  private async upgradeProfile(profile: ProviderProfileRecord): Promise<ProviderProfileRecord> {
    const currentHash = capabilityHash(this.capabilities);
    if (profile.capability_hash === currentHash) return profile;
    const legacy = metamaskSmartAccountLegacyCapabilitySnapshot();
    const direct = metamaskSmartAccountCapabilitySnapshot();
    if (
      profile.provider_id !== METAMASK_SMART_ACCOUNT_PROVIDER_ID ||
      profile.trust_class !== "external_owner_delegated_local_session" ||
      ![
        capabilityHash(legacy),
        capabilityHash(direct),
      ].includes(profile.capability_hash) ||
      ![
        hashObject(legacy),
        hashObject(direct),
      ].includes(hashObject(profile.capability_snapshot)) ||
      profile.drift.state !== "bound"
    ) throw new ApnError("APN_PROFILE_DRIFT", "Smart Account capability state is not eligible for automatic upgrade.");
    const record = await this.store.load(profile.profile_hash);
    const instant = this.instant();
    if (
      record === null || !isGrantedPermissionRecord(record) || record.phase !== "active" ||
      instant.unix >= record.granted_expires_at_unix || record.profile !== profile.profile ||
      record.profile_hash !== profile.profile_hash || record.owner_address.toLowerCase() !== profile.public_address.toLowerCase() ||
      accountBindingHash(METAMASK_SMART_ACCOUNT_PROVIDER_ID, record.owner_address) !== profile.account_binding_hash ||
      profile.revision !== record.revision + (profile.capability_hash === capabilityHash(direct) ? 1 : 0)
    ) throw new ApnError("APN_PROFILE_DRIFT", "Smart Account permission binding is not eligible for automatic upgrade.");
    const target = profile.capability_hash === capabilityHash(legacy) ? direct : this.capabilities;
    return {
      ...profile,
      revision: Math.max(profile.revision, record.revision) + 1,
      capability_snapshot: target,
      capability_hash: capabilityHash(target),
      observed_at: monotonicTimestamp(profile.observed_at, instant.iso),
    };
  }

  async connect(intent: ProviderPermissionConnectIntent): Promise<ProviderPermissionBinding> {
    const instant = this.instant();
    const idempotencyHash = sha256(`idempotency\0${intent.idempotencyKey}`);
    const fingerprint = connectionFingerprint(intent, idempotencyHash);
    let record = await this.store.load(intent.profileHash);
    if (record === null) {
      if (instant.unix >= intent.expiresAtUnix) invalidInput("Permission expiry must be in the future.");
      const session = this.sessionKeys.create();
      record = {
        schema_version: SMART_ACCOUNT_PERMISSION_RECORD_VERSION,
        profile: intent.profile,
        profile_hash: intent.profileHash,
        provider_id: METAMASK_SMART_ACCOUNT_PROVIDER_ID,
        idempotency_hash: idempotencyHash,
        intent_fingerprint: fingerprint,
        phase: "pending_consent",
        revision: 1,
        requested_cap_atomic: intent.capAtomic,
        requested_expires_at_unix: intent.expiresAtUnix,
        starts_at_unix: instant.unix,
        session_address: session.address,
        session_private_key: session.privateKey,
        created_at: instant.iso,
        updated_at: instant.iso,
        max_observed_unix: instant.unix,
        revocation_freshness: "never_synced",
      };
      await this.store.save(record);
    } else {
      assertSameIntent(record, intent, idempotencyHash, fingerprint);
    }
    if (isGrantedPermissionRecord(record)) {
      if (!["grant_committed_pending_profile", "active"].includes(record.phase)) terminalConnect(record.phase);
      const current = await this.materializeExpiry(record, instant);
      return projectPermissionBinding(current, instant.unix);
    }
    if (instant.unix >= record.requested_expires_at_unix) invalidInput("The pending permission intent expired before consent.");
    await assertMetaMaskSmartAccountPackageIdentity();
    const pending = record;
    const observation = await this.consent.request({
      sessionAddress: pending.session_address,
      capAtomic: pending.requested_cap_atomic,
      startsAtUnix: pending.starts_at_unix,
      expiresAtUnix: pending.requested_expires_at_unix,
    });
    const commitInstant = this.instant();
    const grant = validateSmartAccountObservation(observation, requestShape(pending, commitInstant.unix));
    const committed: GrantedSmartAccountPermissionRecord = {
      ...pending,
      phase: "grant_committed_pending_profile",
      owner_address: grant.ownerAddress,
      granted_cap_atomic: grant.grantedCapAtomic,
      granted_expires_at_unix: grant.grantedExpiresAtUnix,
      grant_context: grant.context,
      grant_fingerprint: grant.grantFingerprint,
      delegation_manager: grant.delegationManager,
      permission_response: grant.permissionResponse,
      updated_at: monotonicTimestamp(pending.updated_at, commitInstant.iso),
      max_observed_unix: Math.max(pending.max_observed_unix, commitInstant.unix),
    };
    if (!await this.store.compareAndSet(pending, committed)) staleConsentResult();
    return projectPermissionBinding(committed, commitInstant.unix);
  }

  async activate(profileHash: string): Promise<ProviderPermissionBinding> {
    const instant = this.instant();
    const record = await this.requireGranted(profileHash);
    if (record.phase !== "grant_committed_pending_profile") {
      return projectPermissionBinding(await this.materializeExpiry(record, instant), instant.unix);
    }
    const active: GrantedSmartAccountPermissionRecord = {
      ...record,
      phase: instant.unix >= record.granted_expires_at_unix ? "expired" : "active",
      updated_at: instant.iso,
      max_observed_unix: Math.max(record.max_observed_unix, instant.unix),
    };
    await this.store.save(active);
    return projectPermissionBinding(active, instant.unix);
  }

  async read(profileHash: string): Promise<ProviderPermissionBinding | null> {
    const record = await this.store.load(profileHash);
    if (record === null || !isGrantedPermissionRecord(record)) return null;
    const instant = this.instant();
    return projectPermissionBinding(await this.materializeExpiry(record, instant), instant.unix);
  }

  async readPending(profileHash: string): Promise<ProviderPendingPermissionBinding | null> {
    const record = await this.store.load(profileHash);
    return record === null || isGrantedPermissionRecord(record)
      ? null
      : projectPendingPermissionBinding(record);
  }

  async sync(profileHash: string, expectedRevision: number): Promise<ProviderPermissionBinding> {
    const instant = this.instant();
    const record = await this.requireGranted(profileHash);
    assertRevision(record, expectedRevision);
    const effective = projectPermissionBinding(record, instant.unix);
    if (effective.state === "expired" || ["revoked", "drift_blocked"].includes(effective.state)) terminalLifecycle(effective.state);
    await assertMetaMaskSmartAccountPackageIdentity();
    let preflight: ReturnType<typeof assertSmartAccountPreflight>;
    try {
      const observed = await this.consent.sync({ ownerAddress: record.owner_address });
      preflight = assertSmartAccountPreflight(observed);
    } catch (error) {
      await this.saveTransition(record, {
        phase: record.phase,
        revocation_freshness: "unverified",
        last_foreground_sync_at: instant.iso,
      }, instant);
      throw error;
    }
    const matching = preflight.permission_responses.find((candidate) =>
      candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).context === record.grant_context
    );
    if (matching === undefined) {
      return await this.saveTransition(record, {
        phase: "revoked",
        revocation_freshness: "confirmed_absent",
        last_foreground_sync_at: instant.iso,
      }, instant);
    }
    let validated: ReturnType<typeof validateSmartAccountObservation>;
    try {
      validated = validateSmartAccountObservation(
        { ...preflight, permission_responses: [matching] },
        requestShape(record, instant.unix),
      );
    } catch (error) {
      await this.saveTransition(record, {
        phase: record.phase,
        revocation_freshness: "unverified",
        last_foreground_sync_at: instant.iso,
      }, instant);
      throw error;
    }
    if (validated.grantFingerprint !== record.grant_fingerprint ||
      validated.ownerAddress.toLowerCase() !== record.owner_address.toLowerCase()) {
      return await this.saveTransition(record, {
        phase: "drift_blocked",
        revocation_freshness: "unverified",
        last_foreground_sync_at: instant.iso,
      }, instant);
    }
    return await this.saveTransition(record, {
      phase: record.phase,
      revocation_freshness: "confirmed_present",
      last_foreground_sync_at: instant.iso,
    }, instant);
  }

  async disable(profileHash: string, expectedRevision: number): Promise<ProviderPermissionBinding> {
    const instant = this.instant();
    const record = await this.requireGranted(profileHash);
    assertRevision(record, expectedRevision);
    if (record.phase === "disabled") return projectPermissionBinding(record, instant.unix);
    if (["revoked", "drift_blocked"].includes(record.phase)) terminalLifecycle(record.phase);
    return await this.saveTransition(record, { phase: "disabled" }, instant);
  }

  async forget(profileHash: string, expectedRevision: number): Promise<{ readonly warning: string }> {
    const record = await this.store.load(profileHash);
    if (record !== null) {
      assertRevision(record, expectedRevision);
      if (!await this.store.compareAndSet(record, null)) {
        throw new ApnError("APN_PROFILE_REVISION_CONFLICT", "The Smart Account permission changed during local cancellation.");
      }
    }
    return {
      warning: "Local APN session and permission material were deleted. MetaMask-side authority may still exist; review it in MetaMask.",
    };
  }

  private async requireGranted(profileHash: string): Promise<GrantedSmartAccountPermissionRecord> {
    const record = await this.store.load(profileHash);
    if (record === null || !isGrantedPermissionRecord(record)) {
      throw new ApnError("APN_STATE_CORRUPT", "The Smart Account profile has no committed permission record.");
    }
    return record;
  }

  private async saveTransition(
    record: GrantedSmartAccountPermissionRecord,
    change: Partial<Pick<GrantedSmartAccountPermissionRecord, "phase" | "revocation_freshness" | "last_foreground_sync_at">>,
    instant: { readonly unix: number; readonly iso: string },
  ): Promise<ProviderPermissionBinding> {
    const updatedAt = monotonicTimestamp(record.updated_at, instant.iso);
    const next: GrantedSmartAccountPermissionRecord = {
      ...record,
      ...change,
      revision: record.revision + 1,
      updated_at: updatedAt,
      max_observed_unix: Math.max(record.max_observed_unix, instant.unix),
    };
    await this.store.save(next);
    return projectPermissionBinding(next, instant.unix);
  }

  private async materializeExpiry(
    record: GrantedSmartAccountPermissionRecord,
    instant: { readonly unix: number; readonly iso: string },
  ): Promise<GrantedSmartAccountPermissionRecord> {
    if (record.phase !== "active" || Math.max(record.max_observed_unix, instant.unix) < record.granted_expires_at_unix) {
      return record;
    }
    const expired: GrantedSmartAccountPermissionRecord = {
      ...record,
      phase: "expired",
      revision: record.revision + 1,
      updated_at: monotonicTimestamp(record.updated_at, instant.iso),
      max_observed_unix: Math.max(record.max_observed_unix, instant.unix),
    };
    await this.store.save(expired);
    return expired;
  }

  private instant(): { readonly unix: number; readonly iso: string } {
    const value = this.now();
    const unix = Math.floor(value.getTime() / 1000);
    if (!Number.isSafeInteger(unix) || unix <= 0 || new Date(value).toISOString() !== value.toISOString()) {
      throw new ApnError("APN_INTERNAL", "The Smart Account clock is invalid.");
    }
    return { unix, iso: value.toISOString() };
  }
}

function requestShape(record: SmartAccountPermissionRecord, nowUnix: number): SmartAccountPermissionRequestShape {
  return {
    sessionAddress: record.session_address,
    capAtomic: record.requested_cap_atomic,
    startsAtUnix: record.starts_at_unix,
    expiresAtUnix: record.requested_expires_at_unix,
    nowUnix,
  };
}

function connectionFingerprint(intent: ProviderPermissionConnectIntent, idempotencyHash: string): string {
  return hashObject({
    profile: intent.profile,
    provider: METAMASK_SMART_ACCOUNT_PROVIDER_ID,
    authentication_method: intent.authenticationMethod,
    chain: "eip155:8453",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    requested_cap_atomic: intent.capAtomic,
    requested_expires_at_unix: intent.expiresAtUnix,
    idempotency_hash: idempotencyHash,
  });
}

function assertSameIntent(
  record: SmartAccountPermissionRecord,
  intent: ProviderPermissionConnectIntent,
  idempotencyHash: string,
  fingerprint: string,
): void {
  if (record.profile !== intent.profile || record.profile_hash !== intent.profileHash ||
    record.idempotency_hash !== idempotencyHash || record.intent_fingerprint !== fingerprint) {
    throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "The Smart Account profile or idempotency key is already bound to different permission material.");
  }
}

function assertRevision(record: SmartAccountPermissionRecord, expected: number): void {
  if (record.revision !== expected) {
    throw new ApnError("APN_PROFILE_REVISION_CONFLICT", "The expected Smart Account permission revision is stale.", {
      current_revision: String(record.revision),
    });
  }
}

function invalidInput(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function terminalConnect(state: string): never {
  throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", `Smart Account permission is ${state}; new foreground authority requires a new profile identity.`);
}
function terminalLifecycle(state: string): never {
  throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", `Smart Account permission is ${state} and cannot be reactivated by this command.`);
}
function staleConsentResult(): never {
  throw new ApnError(
    "APN_PROVIDER_PROTOCOL",
    "The MetaMask consent result no longer matches the active pending intent and was not committed.",
    { retryable: false },
  );
}
function unsupportedInternalPath(): never {
  throw new ApnError("APN_INTERNAL", "Smart Account access must use the common permission lifecycle path.");
}

function monotonicTimestamp(previous: string, observed: string): string {
  return new Date(Math.max(Date.parse(observed), Date.parse(previous) + 1)).toISOString();
}

function unavailableDirectExecution(): DirectExecutionPort {
  return {
    mode: "delegated_session_transaction",
    prepare: async () => {
      throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "Smart Account direct execution requires an explicit Base RPC.");
    },
    execute: async () => ({ disposition: "not_started", reason: "provider_binary_unavailable" }),
  };
}

function unavailableX402Material(): X402PaymentMaterialPort {
  const unavailable = async (): Promise<never> => {
    throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "Smart Account x402 requires an explicit Base RPC.");
  };
  return {
    method: "erc7710",
    prepare: unavailable,
    materialize: unavailable,
    recover: unavailable,
    markExposed: unavailable,
  };
}
