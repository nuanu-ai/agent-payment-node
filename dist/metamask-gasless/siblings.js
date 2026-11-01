import { mmDispatchIntent } from "./dispatch.js";
import { mmActualGross } from "./economics.js";
import { mmFail } from "./reasons.js";
/** Said once beside the listed transfers, on the approval screen and in the prepare and approve output. */
export const MM_SIBLING_WARNING = "Each earlier MetaMask gasless transfer listed here, from the same server wallet on this chain, has no proved " +
    "outcome yet and may still complete beside this one.";
/**
 * The account's earlier MetaMask gasless transfers this one proceeds beside (see the index adapter), collected before the
 * approval screen; none of their outcomes is proved, so no amount beyond what each one dispatched is named. Empty adds nothing.
 */
export function mmSiblingsOutput(siblings) {
    return siblings.length === 0 ? {} : { unresolved_beside: { operations: siblings.map(sibling => ({ operation_id: sibling.operationId,
                state: sibling.state, recipient: sibling.intent.request.recipient, dispatched_gross_atomic: mmActualGross(mmDispatchIntent(sibling).quote) })),
            warning: MM_SIBLING_WARNING } };
}
/** A delegation hash an unresolved sibling also holds would make the two transfers' redemption proofs indistinguishable. */
export function mmAssertUniqueDelegation(delegationHash, siblings) {
    if (siblings.some(sibling => [sibling.intent.delegationHash, mmDispatchIntent(sibling).delegationHash].includes(delegationHash))) {
        mmFail("mm_gasless_delegation_reused");
    }
}
//# sourceMappingURL=siblings.js.map