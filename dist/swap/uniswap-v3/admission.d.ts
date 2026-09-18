import type { StateStore } from "../../state.js";
import { type SwapOperationRecord } from "../model.js";
import type { GuardedSwapOwnerAdmissionPort, GuardedSwapPolicyResolver } from "../runtime.js";
import type { UniswapOwnerAdmission, UniswapOwnerAdmissionPort } from "../uniswap-ethereum/execution/types.js";
/**
 * Owner admission for the local non-custodial wallet: the profile's active sealed policy must still be the one the
 * operation was prepared under, and the profile's existing local wallet must still be the quoted account.
 */
export declare class UniswapLocalOwnerAdmission implements GuardedSwapOwnerAdmissionPort, UniswapOwnerAdmissionPort {
    private readonly state;
    private readonly policy;
    constructor(state: StateStore, policy: GuardedSwapPolicyResolver);
    assert(operationValue: SwapOperationRecord): Promise<UniswapOwnerAdmission>;
}
