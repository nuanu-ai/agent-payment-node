import type { Address, Hex } from "../model.js";
import type { MetaMaskGaslessState } from "./model.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
/** Said once beside the listed transfers, on the approval screen and in the prepare and approve output. */
export declare const MM_SIBLING_WARNING: string;
/** One earlier transfer as its own record holds it: the recipient and the gross of the batch actually dispatched. */
export interface MetaMaskGaslessSiblingOutput {
    readonly operation_id: string;
    readonly state: MetaMaskGaslessState;
    readonly recipient: Address;
    readonly dispatched_gross_atomic: string;
}
export interface MetaMaskGaslessSiblingsOutput {
    readonly unresolved_beside?: {
        readonly operations: readonly MetaMaskGaslessSiblingOutput[];
        readonly warning: string;
    };
}
/**
 * The account's earlier MetaMask gasless transfers this one proceeds beside (see the index adapter), collected before the
 * approval screen; none of their outcomes is proved, so no amount beyond what each one dispatched is named. Empty adds nothing.
 */
export declare function mmSiblingsOutput(siblings: readonly MetaMaskGaslessOperationRecord[]): MetaMaskGaslessSiblingsOutput;
/** A delegation hash an unresolved sibling also holds would make the two transfers' redemption proofs indistinguishable. */
export declare function mmAssertUniqueDelegation(delegationHash: Hex, siblings: readonly MetaMaskGaslessOperationRecord[]): void;
