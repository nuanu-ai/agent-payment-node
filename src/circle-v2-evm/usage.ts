import { AsyncLocalStorage } from "node:async_hooks";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, validateAssetUsageReservation, type AssetUsageReservation, type AssetUsageIdentity } from "../asset-usage-ledger.js";
import { canonicalJson, hashObject } from "../canonical.js";
import type { StateStore } from "../state.js";
import { CIRCLE_SOURCE_TOKEN, circleRoute, type CircleDestinationChain } from "./catalog.js";
import { circleBlocked, circleCorrupt, type CircleOperationV1, type CirclePolicy } from "./operation-model.js";
export const circleMechanism = (chain: CircleDestinationChain) => ({ provider: "circle-cctp-v2", reference: `circle-v2-evm-fast-42161-${chain}.v1` });
interface Lease { readonly key: string; readonly profile: string; readonly identity: AssetUsageIdentity; readonly amount: string; }
function leases(op: CircleOperationV1): readonly Lease[] {
  const source = op.sourceCustody.walletAddress, destination = op.destinationCustody.walletAddress;
  return [{ key: "usdc", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "token", identifier: CIRCLE_SOURCE_TOKEN } }, amount: "40100" },
    { key: "approval-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "30000000000000" },
    { key: "burn-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "30000000000000" },
    { key: "cleanup-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "15000000000000" },
    { key: "mint-native", profile: op.destinationProfile, identity: { account: destination, chain: `eip155:${op.destinationChain}`, asset: { kind: "native", identifier: null } }, amount: circleRoute(op.destinationChain, op.destinationProfile).destinationNativeCap }];
}
export class CircleUsage {
  private readonly ledger: AssetUsageLedger;
  private readonly policiesStore: AllowlistPolicyStore;
  private readonly policyScope = new AsyncLocalStorage<{ readonly profiles: ReadonlySet<string>; active: boolean }>();
  constructor(private readonly state: StateStore, private readonly now: () => number) { this.ledger = new AssetUsageLedger(state.root); this.policiesStore = new AllowlistPolicyStore(state.root); }
  /** Wallet/operation/address locks are outermost; policy locks are held through every effect. */
  async withPolicyLocks<T>(profiles: readonly string[], action: () => Promise<T>): Promise<T> {
    if (this.policyScope.getStore() !== undefined) circleBlocked("policy_lock_scope_reentry");
    const canonical = [...new Set(profiles)].sort(), keys = canonical.map(p => `profile:${allowlistProfileHash(p)}`).sort();
    return this.state.withLocks(keys, () => {
      const scope = { profiles: new Set(canonical), active: true };
      return this.policyScope.run(scope, async () => { try { return await action(); } finally { scope.active = false; } });
    });
  }
  private async active(profile: string, account: string): Promise<ActiveAssetPolicy> {
    const scope = this.policyScope.getStore();
    if (scope?.active !== true || !scope.profiles.has(profile)) circleBlocked("owner_policy_lock_required");
    const stored = await this.policiesStore.readUnderProfileLock(profile);
    if (!scope.active) circleBlocked("owner_policy_lock_required");
    const active = activeAssetPolicyFromState(stored, new Date(this.now()));
    if (active === null || active.accounts.evm !== account) circleBlocked("active_owner_asset_policy_required"); return active;
  }
  async policies(op: CircleOperationV1): Promise<readonly CirclePolicy[]> {
    const result: CirclePolicy[] = [];
    for (const lease of leases(op)) {
      const active = await this.active(lease.profile, lease.identity.account), at = new Date(this.now()), current = await this.ledger.usageReadOnly(lease.identity, at);
      const admission = evaluateAssetPolicy(active.registry, { chain: lease.identity.chain, asset: lease.identity.asset, rail: "bridge", mechanism: circleMechanism(op.destinationChain), amountAtomic: lease.amount,
        dailyUsageAtomic: current.amountAtomic, asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
      if (!bridgeMechanismAdmitted(admission, circleMechanism(op.destinationChain))) circleBlocked("exact_circle_mechanism_admission_required");
      const policy = { profile: lease.profile, profileHash: this.state.profileHash(lease.profile), policyDigest: active.digest, revision: active.revision, activationDigest: active.activationDigest };
      if (!result.some(row => row.profileHash === policy.profileHash)) result.push(policy);
    }
    return result;
  }
  async confirm(op: CircleOperationV1): Promise<void> {
    for (const policy of op.policies) {
      const account = policy.profile === op.profile ? op.sourceCustody.walletAddress : op.destinationCustody.walletAddress;
      const active = await this.active(policy.profile, account);
      if (policy.activationDigest === undefined || active.activationDigest !== policy.activationDigest || active.digest !== policy.policyDigest || active.revision !== policy.revision) circleBlocked("owner_policy_changed");
    }
    if (op.usage.length !== 5) circleBlocked("all_asset_usage_reserves_required");
    for (const [index, row] of op.usage.entries()) {
      validateAssetUsageReservation(row); const saved = await this.ledger.load(row, row.reservationId);
      if (saved === null || saved.policyDigest !== row.policyDigest || saved.amountAtomic !== row.amountAtomic || saved.account !== row.account || saved.chain !== row.chain ||
        ["failed_before_effect", "failed_confirmed_revert", "released_unsubmitted", "finalized"].includes(saved.state)) circleBlocked("asset_usage_hold_changed");
      const lease = leases(op)[index]!, active = await this.active(lease.profile, lease.identity.account), at = new Date(this.now());
      const current = await this.ledger.usageReadOnly(lease.identity, at), other = BigInt(current.amountAtomic) - BigInt(saved.amountAtomic);
      if (other < 0n) circleCorrupt("usage_total_below_hold");
      const admission = evaluateAssetPolicy(active.registry, { chain: lease.identity.chain, asset: lease.identity.asset, rail: "bridge", mechanism: circleMechanism(op.destinationChain),
        amountAtomic: lease.amount, dailyUsageAtomic: other.toString(), asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
      if (!bridgeMechanismAdmitted(admission, circleMechanism(op.destinationChain))) circleBlocked("exact_circle_mechanism_admission_required");
    }
  }
  async reserve(op: CircleOperationV1): Promise<readonly AssetUsageReservation[]> {
    const result: AssetUsageReservation[] = [];
    for (const lease of leases(op)) {
      const active = await this.active(lease.profile, lease.identity.account), frozen = op.policies.find(p => p.profile === lease.profile);
      if (frozen === undefined || frozen.activationDigest === undefined || active.activationDigest !== frozen.activationDigest || active.digest !== frozen.policyDigest || active.revision !== frozen.revision) circleBlocked("reserve_policy_changed");
      const reservation = await this.ledger.reserve({ ...lease.identity, registry: active.registry, rail: "bridge", mechanism: circleMechanism(op.destinationChain), amountAtomic: lease.amount,
        idempotencyKey: `circle-v2-evm.v1:${op.operationId}:${lease.key}`, now: new Date(this.now()) });
      if (reservation.state !== "reserved") circleBlocked("reserve_replay_already_exposed"); result.push(reservation);
    }
    return result;
  }
  async follow(op: CircleOperationV1, target: "unknown_finality" | "finalized" | "failed_confirmed_revert" | "failed_before_effect"): Promise<readonly AssetUsageReservation[]> {
    let rows = op.usage;
    if (target === "failed_before_effect" && rows.length === 0) {
      const existing: AssetUsageReservation[] = [];
      for (const lease of leases(op)) {
        const saved = await this.ledger.load(lease.identity, assetUsageReservationId(lease.identity, `circle-v2-evm.v1:${op.operationId}:${lease.key}`));
        if (saved === null) break;
        const policy = op.policies.find(p => p.profile === lease.profile);
        if (saved.policyDigest !== policy?.policyDigest || saved.amountAtomic !== lease.amount || !["reserved", "failed_before_effect"].includes(saved.state)) circleBlocked("unsubmitted_reserve_exposed_or_drifted");
        existing.push(saved);
      }
      rows = existing;
    }
    if (target !== "failed_before_effect" && rows.length !== 5) circleCorrupt("usage_missing");
    const result: AssetUsageReservation[] = [];
    for (const [index, row] of rows.entries()) {
      const current = await this.ledger.load(row, row.reservationId); if (current === null) circleCorrupt("usage_missing");
      const actualTarget = target === "finalized" && index === 3 ? "failed_confirmed_revert" : target;
      if (current.state === actualTarget) { result.push(current); continue; }
      const isTerminal = actualTarget !== "unknown_finality";
      let consumed: string | undefined;
      if (actualTarget === "failed_confirmed_revert") {
        consumed = index === 1 ? op.effects.find(e => e.role === "approval")?.proof?.actualFeeAtomic ?? "0" : index === 2 ? op.effects.find(e => e.role === "burn")?.proof?.actualFeeAtomic ?? "0" : index === 3 ? op.effects.find(e => e.role === "cleanup")?.proof?.actualFeeAtomic ?? "0" : "0";
      }
      // Finalized reserves intentionally charge the owner's full approved caps; receipt retains exact native cost.
      const outcomeDigest = hashObject({ operationId: op.operationId, target, source: op.source?.sourceMessageHash ?? null, destination: op.destination?.transactionHash ?? null,
        cleanup: op.effects.find(e => e.role === "cleanup")?.transactionHash ?? null, reservation: row.reservationId });
      result.push(await this.ledger.transition({ account: row.account, chain: row.chain, asset: row.asset, reservationId: row.reservationId, policyDigest: row.policyDigest,
        state: actualTarget, now: new Date(this.now()), ...(target === "failed_before_effect" ? { expectedCurrentStates: ["reserved", "failed_before_effect"] as const } : {}), ...(isTerminal ? { outcomeDigest } : {}), ...(consumed === undefined ? {} : { consumedAtomic: consumed }) }));
    }
    return result;
  }
}
