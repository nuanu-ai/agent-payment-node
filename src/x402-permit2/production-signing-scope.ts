import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { StateStore } from "../state.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { activeAssetPolicyFromState } from "../allowlist-active-policy.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { walletCustodyLock } from "../encrypted-wallet-store.js";
import { evmAddressLock, assertExclusiveEvmOwner } from "../evm-address-ownership.js";
import { OperationService } from "../operation-service.js";
import { decodePermit2WalletBinding } from "./owner-binding.js";
import { assertPermit2OwnerIdentity, assertPermit2OwnerCaps } from "./production-owner-validation.js";
import { assertSigningLifecycle, checkedSigningLease, type Permit2MetadataMode, type Permit2SavedIdentity } from "./production-signing-owner.js";
import { assertSigningTime } from "./production-signing-facts.js";
import { productionUsageIdentity, type Permit2ProductionRecord, type Permit2ProductionRepository } from "./production-repository.js";

type Context = { readonly record: Permit2ProductionRecord; readonly mode: Permit2MetadataMode;
  readonly keys: readonly string[]; readonly close: Set<() => void>;
  time?: { readonly policy: Awaited<ReturnType<AllowlistPolicyStore["readUnderProfileLock"]>>; readonly wallet: ReturnType<typeof decodePermit2WalletBinding>; readonly used: string } };
/** Lives only inside Permit2MetadataLockOwner.within, while its metadata locks are held; it carries no key, approval,
 * signature or transport authority, only the lexical fact that those locks are held. */
export class Permit2MetadataLockScope {
  readonly kind = "permit2-metadata-lock-scope" as const;
  readonly #owner: Permit2MetadataLockOwner;
  #context: Context | null;
  constructor(owner: Permit2MetadataLockOwner, context: Context) { this.#owner = owner; this.#context = context; }
  static held(scope: unknown, owner: Permit2MetadataLockOwner): Context {
    if (!(scope instanceof Permit2MetadataLockScope) || scope.#owner !== owner || scope.#context === null) blocked();
    return scope.#context;
  }
  static exit(scope: Permit2MetadataLockScope): void {
    const context = scope.#context; scope.#context = null; for (const close of context?.close ?? []) close();
  }
}
/** An actual metadata lock callback only. No key, approval, signature or transport authority. */
export class Permit2MetadataLockOwner {
  readonly #state: StateStore;
  readonly #records: Permit2ProductionRepository;
  readonly #policies: AllowlistPolicyStore;
  constructor(state: StateStore, records: Permit2ProductionRepository) {
    this.#state = state; this.#records = records; this.#policies = new AllowlistPolicyStore(state.root);
  }
  async within<T>(id: string, mode: Permit2MetadataMode, clock: () => Date,
    action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T> {
    const initial = await this.#records.findOperation(id); if (initial === null) blocked();
    assertSigningLifecycle(initial, mode); assertSigningTime(initial, clock());
    await this.#state.initialize();
    const outer = [`profile:${initial.profileHash}`, `operation:${id}`, evmAddressLock(initial.material.wallet.account)];
    const custody = walletCustodyLock(this.#state, initial.material.wallet.profile);
    const policy = `profile:${allowlistProfileHash(initial.material.wallet.profile)}`;
    return this.#state.withLocks(outer, async () => this.#state.withLocks([custody], async () =>
      this.#policies.withLocks([policy], async () => {
        const current = await this.#records.findOperation(id);
        if (current === null || current.integrityHash !== initial.integrityHash) blocked();
        assertSigningLifecycle(current, mode); freeze(current);
        const scope = new Permit2MetadataLockScope(this, { record: current, mode, keys: Object.freeze([...outer, custody, policy]), close: new Set() });
        try { await this.owner(scope, id, mode, clock); this.assert(scope, id, mode); return await action(scope); }
        finally { Permit2MetadataLockScope.exit(scope); }
      })));
  }
  assert(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode): void {
    const c = Permit2MetadataLockScope.held(scope, this);
    if (c.record.operationId !== id || c.mode !== mode || c.record.material.wallet.profileHash !== c.record.profileHash) blocked();
    const keys = [`profile:${c.record.profileHash}`, `operation:${id}`, evmAddressLock(c.record.material.wallet.account),
      walletCustodyLock(this.#state, c.record.material.wallet.profile), `profile:${allowlistProfileHash(c.record.material.wallet.profile)}`];
    if (c.keys.length !== keys.length || c.keys.some((key, index) => key !== keys[index])) blocked();
  }
  assertTime(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, at: Date): void {
    this.assert(scope, id, mode); const c = Permit2MetadataLockScope.held(scope, this), t = c.time; if (t === undefined) blocked();
    const policy = activeAssetPolicyFromState(t.policy, at); assertPermit2OwnerIdentity(c.record, t.wallet, policy);
    assertPermit2OwnerCaps(c.record, at, t.used, policy); assertSigningTime(c.record, at);
  }
  onExit(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, close: () => void): () => void {
    this.assert(scope, id, mode); const c = Permit2MetadataLockScope.held(scope, this); c.close.add(close); return () => { c.close.delete(close); };
  }
  async owner(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, clock: () => Date,
    expected?: Permit2SavedIdentity) {
    this.assert(scope, id, mode); const frozen = Permit2MetadataLockScope.held(scope, this).record;
    const record = await this.#records.findOperation(id); this.assert(scope, id, mode);
    if (record === null || record.integrityHash !== frozen.integrityHash ||
      expected !== undefined && sha256(canonicalJson(record.material.wallet)) !== expected.walletHash) blocked();
    assertSigningLifecycle(record, mode); assertSigningTime(record, clock());
    // Ordinary bucket lock remains: no optimistic multi-file usage snapshot or aggregate bypass.
    const usage = await new AssetUsageLedger(this.#state.root).usageWithReservation(productionUsageIdentity(record), record.usageReservationId, clock());
    this.assert(scope, id, mode); const lease = checkedSigningLease(record, usage.reservation, mode, expected);
    const used = BigInt(usage.snapshot.amountAtomic) - BigInt(lease.amountAtomic); if (used < 0n) blocked();
    const profile = record.material.wallet.profile, profileHash = this.#state.profileHash(profile);
    const artifacts = await this.#state.loadWalletArtifacts(profile, profileHash); this.assert(scope, id, mode);
    const provider = await this.#state.loadProviderProfile(profileHash); this.assert(scope, id, mode);
    const wallet = decodePermit2WalletBinding(profile, profileHash, artifacts, provider);
    await assertExclusiveEvmOwner(this.#state, wallet.account, wallet.profileHash); this.assert(scope, id, mode);
    const policy = await this.#policies.readUnderProfileLock(wallet.profile); this.assert(scope, id, mode);
    const active = activeAssetPolicyFromState(policy, clock()); assertPermit2OwnerIdentity(record, wallet, active);
    await new OperationService(this.#state).assertPermit2AccountAvailable(record); this.assert(scope, id, mode);
    const at = clock(), currentPolicy = activeAssetPolicyFromState(policy, at);
    assertPermit2OwnerIdentity(record, wallet, currentPolicy);
    assertPermit2OwnerCaps(record, at, used.toString(), currentPolicy); assertSigningTime(record, clock());
    Permit2MetadataLockScope.held(scope, this).time = { policy, wallet, used: used.toString() };
    return { record, lease };
  }
}
function freeze(value: unknown): void { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } }
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 metadata lock scope is not active or bound to its owned operation."); }
