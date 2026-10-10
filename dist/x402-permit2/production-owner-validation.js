import { canonicalJson } from "../canonical.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { X402_PERMIT2_MECHANISM } from "./registry.js";
/** Pure existing predicates; these functions confer no lock, policy-reader or signing authority. */
export function assertPermit2OwnerIdentity(record, wallet, active) {
    if (canonicalJson(wallet) !== canonicalJson(record.material.wallet) || active === null ||
        active.digest !== record.material.owner.policyDigest || active.registry.registryVersion !== record.material.checkpoint.registryVersion ||
        active.revision !== record.material.checkpoint.policyRevision || active.activationDigest !== record.material.checkpoint.activationDigest ||
        active.accounts.evm?.toLowerCase() !== wallet.account.toLowerCase())
        blocked("Permit2 current owner binding or policy activation changed.");
}
export function assertPermit2OwnerCaps(record, now, usage, active) {
    const p = reconstructPermit2ProductionMaterial(record.material);
    if (BigInt(p.expiresAtUnix) <= BigInt(Math.floor(now.getTime() / 1000)))
        blocked("Permit2 authorization expired.");
    evaluateAssetPolicy(active.registry, { chain: p.chain, asset: { kind: "token", identifier: p.token }, rail: "x402", mechanism: X402_PERMIT2_MECHANISM,
        amountAtomic: p.amountAtomic, dailyUsageAtomic: usage, asOf: now.toISOString(), asOfDate: now.toISOString().slice(0, 10) });
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
//# sourceMappingURL=production-owner-validation.js.map