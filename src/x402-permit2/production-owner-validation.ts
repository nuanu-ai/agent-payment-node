import { canonicalJson } from "../canonical.js";
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import type { Permit2WalletBinding } from "./owner-binding.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
import { X402_PERMIT2_MECHANISM } from "./registry.js";
/** Pure existing predicates; these functions confer no lock, policy-reader or signing authority. */
export function assertPermit2OwnerIdentity(record: Permit2ProductionRecord, wallet: Permit2WalletBinding,
  active: ActiveAssetPolicy | null): asserts active is ActiveAssetPolicy {
  if (canonicalJson(wallet) !== canonicalJson(record.material.wallet) || active === null ||
      active.digest !== record.material.owner.policyDigest || active.registry.registryVersion !== record.material.checkpoint.registryVersion ||
      active.revision !== record.material.checkpoint.policyRevision || active.activationDigest !== record.material.checkpoint.activationDigest ||
      active.accounts.evm?.toLowerCase() !== wallet.account.toLowerCase()) blocked("Permit2 current owner binding or policy activation changed.");
}
export function assertPermit2OwnerCaps(record: Permit2ProductionRecord, now: Date, usage: string, active: ActiveAssetPolicy): void {
  const p = reconstructPermit2ProductionMaterial(record.material);
  if (BigInt(p.expiresAtUnix) <= BigInt(Math.floor(now.getTime() / 1000))) blocked("Permit2 authorization expired.");
  evaluateAssetPolicy(active.registry, { chain: p.chain, asset: { kind: "token", identifier: p.token }, rail: "x402", mechanism: X402_PERMIT2_MECHANISM,
    amountAtomic: p.amountAtomic, dailyUsageAtomic: usage, asOf: now.toISOString(), asOfDate: now.toISOString().slice(0, 10) });
}
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
