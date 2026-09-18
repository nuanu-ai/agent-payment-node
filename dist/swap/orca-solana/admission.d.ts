import type { ChainAccount, ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { type SwapOperationRecord } from "../model.js";
import type { GuardedSwapOwnerAdmissionPort, GuardedSwapPolicyResolver } from "../runtime.js";
export interface OrcaOwnerAdmission {
    readonly account: ChainAccount;
    readonly accountBindingHash: string;
    readonly admissionHash: string;
}
/**
 * Owner admission for the local non-custodial Solana wallet: the profile's active sealed policy must still be the one
 * the operation was prepared under, and the profile's existing local Solana account must still be the quoted owner.
 */
export declare class OrcaLocalOwnerAdmission implements GuardedSwapOwnerAdmissionPort {
    private readonly accounts;
    private readonly policy;
    constructor(accounts: Pick<ChainWalletStoragePort, "account">, policy: GuardedSwapPolicyResolver);
    assert(operationValue: SwapOperationRecord): Promise<OrcaOwnerAdmission>;
    /** Status needs the account to open the sealed effect, but never the policy: observation survives a revoked policy. */
    localAccount(operationValue: SwapOperationRecord): Promise<ChainAccount>;
}
export declare function orcaAccountBindingHash(account: ChainAccount): string;
