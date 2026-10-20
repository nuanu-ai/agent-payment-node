import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessIntent } from "../model.js";
/** The one call that disables exactly the dispatched delegation, and the manager's own hash query for it. */
export interface MetaMaskDisableCall {
    readonly from: Address;
    readonly to: Address;
    readonly data: Hex;
    /** `getDelegationHash(delegation)`: the pinned manager hashes the very tuple the call carries. */
    readonly hashQuery: Hex;
    readonly delegationHash: Hex;
    readonly callHash: string;
}
/**
 * `DelegationManager.disableDelegation(delegation)` for the delegation actually dispatched (`mmDispatchIntent`), sent
 * by its delegator, the server wallet: the manager accepts it only from that address (`onlyDeleGator`). The signature
 * field is not part of the delegation hash, so the unsigned material APN holds names the same delegation.
 */
export declare function mmDisableCall(dispatched: MetaMaskGaslessIntent): MetaMaskDisableCall;
