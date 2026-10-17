import { canonicalJson, domainHash } from "../../canonical.js";
import { validateChainAccount } from "../../chain-account-store.js";
import type { ChainAccount, ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import { assertActiveSwapPolicyUnchanged } from "../family-guards.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import type { GuardedSwapOwnerAdmissionPort, GuardedSwapPolicyResolver } from "../runtime.js";

export interface SunSwapLocalOwnerAdmissionResult {
  readonly account: ChainAccount;
  readonly admissionHash: string;
}

/**
 * Owner admission for the local non-custodial TRON key: the profile's active sealed policy must still be the one the
 * operation was prepared under, and the profile's existing local TRON account must still be the quoted account.
 */
export class SunSwapLocalOwnerAdmission implements GuardedSwapOwnerAdmissionPort {
  constructor(private readonly accounts: Pick<ChainWalletStoragePort, "account">, private readonly policy: GuardedSwapPolicyResolver) {}

  async assert(operationValue: SwapOperationRecord): Promise<SunSwapLocalOwnerAdmissionResult> {
    const operation = validateSwapOperation(operationValue);
    await assertActiveSwapPolicyUnchanged(this.policy, operation);
    const stored = await this.accounts.account(operation.quote.profile, "tron");
    if (stored === null) blocked("The profile has no local TRON account.", "swap_owner_account");
    const account = validateChainAccount(stored);
    if (account.profile !== operation.quote.profile || account.rail !== "tron" || account.network !== "mainnet" ||
        account.provider !== "local" || account.custody !== "local_software" || account.address !== operation.quote.account) {
      blocked("The profile's local TRON account is not the quoted swap account.", "swap_owner_account");
    }
    return { account, admissionHash: domainHash("apn.sunswap-owner-admission.v1", canonicalJson({ account,
      operationId: operation.operationId, policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest })) };
  }
}

function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
