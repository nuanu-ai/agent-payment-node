import type { ChainAccount, ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { type SwapOperationRecord } from "../model.js";
import type { GuardedSwapOwnerAdmissionPort, GuardedSwapPolicyResolver } from "../runtime.js";
export interface SunSwapLocalOwnerAdmissionResult {
    readonly account: ChainAccount;
    readonly admissionHash: string;
}
/**
 * Owner admission for the local non-custodial TRON key: the profile's active sealed policy must still be the one the
 * operation was prepared under, and the profile's existing local TRON account must still be the quoted account.
 */
export declare class SunSwapLocalOwnerAdmission implements GuardedSwapOwnerAdmissionPort {
    private readonly accounts;
    private readonly policy;
    constructor(accounts: Pick<ChainWalletStoragePort, "account">, policy: GuardedSwapPolicyResolver);
    assert(operationValue: SwapOperationRecord): Promise<SunSwapLocalOwnerAdmissionResult>;
}
