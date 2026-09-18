import { canonicalJson, domainHash } from "../../canonical.js";
import { validateAssetPolicyRegistry } from "../../asset-policy-registry.js";
import { ApnError } from "../../errors.js";
import { bridgeOwner } from "../../lifi/owner.js";
import { validateSwapOperation } from "../model.js";
/**
 * Owner admission for the local non-custodial wallet: the profile's active sealed policy must still be the one the
 * operation was prepared under, and the profile's existing local wallet must still be the quoted account.
 */
export class UniswapLocalOwnerAdmission {
    state;
    policy;
    constructor(state, policy) {
        this.state = state;
        this.policy = policy;
    }
    async assert(operationValue) {
        const operation = validateSwapOperation(operationValue);
        const active = await this.policy(operation.quote.profile);
        if (active === null)
            blocked("No active owner swap admission is installed for this profile.", "swap_owner_admission_required");
        const registry = validateAssetPolicyRegistry(active);
        if (registry.policyDigest !== operation.policyDigest || registry.registryVersion !== operation.policyVersion) {
            blocked("The active owner policy changed after preparation.", "swap_policy_drift");
        }
        const { owner } = await bridgeOwner(this.state, operation.quote.profile);
        if (owner.profile !== operation.quote.profile || owner.address !== operation.quote.account) {
            blocked("The profile's local wallet is not the quoted swap account.", "swap_owner_account");
        }
        return { profile: owner.profile, profileHash: operation.ownerProfileHash, account: owner.address,
            walletBindingHash: owner.walletBindingHash, walletCreatedAt: owner.walletCreatedAt,
            admissionHash: domainHash("apn.uniswap-owner-admission.v1", canonicalJson({ owner, operationId: operation.operationId,
                policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest })) };
    }
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=admission.js.map