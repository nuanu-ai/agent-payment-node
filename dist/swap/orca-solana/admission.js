import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { assertActiveSwapPolicyUnchanged } from "../family-guards.js";
import { validateSwapOperation } from "../model.js";
/**
 * Owner admission for the local non-custodial Solana wallet: the profile's active sealed policy must still be the one
 * the operation was prepared under, and the profile's existing local Solana account must still be the quoted owner.
 */
export class OrcaLocalOwnerAdmission {
    accounts;
    policy;
    constructor(accounts, policy) {
        this.accounts = accounts;
        this.policy = policy;
    }
    async assert(operationValue) {
        const operation = validateSwapOperation(operationValue);
        await assertActiveSwapPolicyUnchanged(this.policy, operation);
        const account = await this.localAccount(operation);
        return { account, accountBindingHash: orcaAccountBindingHash(account), admissionHash: domainHash("apn.orca-owner-admission.v1", canonicalJson({ account, operationId: operation.operationId, policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest })) };
    }
    /** Status needs the account to open the sealed effect, but never the policy: observation survives a revoked policy. */
    async localAccount(operationValue) {
        const operation = validateSwapOperation(operationValue);
        const account = await this.accounts.account(operation.quote.profile, "solana");
        if (account === null || account.provider !== "local" || account.custody !== "local_software" || account.address !== operation.quote.account) {
            blocked("The profile's local Solana wallet is not the quoted swap owner.", "swap_owner_account");
        }
        return account;
    }
}
export function orcaAccountBindingHash(account) { return domainHash("apn.orca-owner-account.v1", canonicalJson(account)); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=admission.js.map