import { canonicalJson, domainHash } from "../../canonical.js";
import { validateAssetPolicyRegistry } from "../../asset-policy-registry.js";
import type { ChainAccount, ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import type { GuardedSwapOwnerAdmissionPort, GuardedSwapPolicyResolver } from "../runtime.js";

export interface OrcaOwnerAdmission { readonly account: ChainAccount; readonly accountBindingHash: string; readonly admissionHash: string }

/**
 * Owner admission for the local non-custodial Solana wallet: the profile's active sealed policy must still be the one
 * the operation was prepared under, and the profile's existing local Solana account must still be the quoted owner.
 */
export class OrcaLocalOwnerAdmission implements GuardedSwapOwnerAdmissionPort {
  constructor(private readonly accounts: Pick<ChainWalletStoragePort, "account">, private readonly policy: GuardedSwapPolicyResolver) {}

  async assert(operationValue: SwapOperationRecord): Promise<OrcaOwnerAdmission> {
    const operation = validateSwapOperation(operationValue);
    const active = await this.policy(operation.quote.profile);
    if (active === null) blocked("No active owner swap admission is installed for this profile.", "swap_owner_admission_required");
    const registry = validateAssetPolicyRegistry(active);
    if (registry.policyDigest !== operation.policyDigest || registry.registryVersion !== operation.policyVersion) {
      blocked("The active owner policy changed after preparation.", "swap_policy_drift");
    }
    const account = await this.localAccount(operation);
    return { account, accountBindingHash: orcaAccountBindingHash(account), admissionHash: domainHash("apn.orca-owner-admission.v1",
      canonicalJson({ account, operationId: operation.operationId, policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest })) };
  }

  /** Status needs the account to open the sealed effect, but never the policy: observation survives a revoked policy. */
  async localAccount(operationValue: SwapOperationRecord): Promise<ChainAccount> {
    const operation = validateSwapOperation(operationValue);
    const account = await this.accounts.account(operation.quote.profile, "solana");
    if (account === null || account.provider !== "local" || account.custody !== "local_software" || account.address !== operation.quote.account) {
      blocked("The profile's local Solana wallet is not the quoted swap owner.", "swap_owner_account");
    }
    return account;
  }
}

export function orcaAccountBindingHash(account: ChainAccount): string { return domainHash("apn.orca-owner-account.v1", canonicalJson(account)); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
