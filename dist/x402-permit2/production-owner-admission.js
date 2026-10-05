import { canonicalJson } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import { assertExclusiveEvmOwner } from "../evm-address-ownership.js";
import { permit2WalletBinding } from "./owner-binding.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { X402_PERMIT2_MECHANISM } from "./registry.js";
/** Caller holds the existing profile/operation/account locks; common usage was sampled outside them. */
export async function assertPermit2OwnerLocked(state, operations, record, now, usage) {
    const wallet = await permit2WalletBinding(state, record.material.wallet.profile);
    await assertExclusiveEvmOwner(state, wallet.account, wallet.profileHash);
    const active = await loadActiveAssetPolicyRegistry(state.root, wallet.profile, now);
    if (canonicalJson(wallet) !== canonicalJson(record.material.wallet) || active === null ||
        active.digest !== record.material.owner.policyDigest || active.registry.registryVersion !== record.material.checkpoint.registryVersion ||
        active.revision !== record.material.checkpoint.policyRevision ||
        active.activationDigest !== record.material.checkpoint.activationDigest || active.accounts.evm?.toLowerCase() !== wallet.account.toLowerCase()) {
        blocked("Permit2 current owner binding or policy activation changed.");
    }
    await operations.assertPermit2AccountAvailable(record);
    const p = reconstructPermit2ProductionMaterial(record.material);
    if (BigInt(p.expiresAtUnix) <= BigInt(Math.floor(now.getTime() / 1000)))
        blocked("Permit2 authorization expired.");
    evaluateAssetPolicy(active.registry, { chain: p.chain, asset: { kind: "token", identifier: p.token }, rail: "x402", mechanism: X402_PERMIT2_MECHANISM,
        amountAtomic: p.amountAtomic, dailyUsageAtomic: usage, asOf: now.toISOString(), asOfDate: now.toISOString().slice(0, 10) });
    return active;
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
//# sourceMappingURL=production-owner-admission.js.map