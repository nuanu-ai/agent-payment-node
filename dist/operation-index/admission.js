import { OperationIndex } from "./index.js";
/**
 * Admits a new operation of a family outside the OperationService facade. Its claims are checked and written to the
 * operation index as one step before `work` (the family's prepare body: RPC reads, signing material, the durable record)
 * runs, and removed when `work` fails or writes no record. `holds` are held besides `claims` but never waited for.
 */
export async function admitOperation(state, identity, claims, work, holds = []) {
    return await new OperationIndex(state).admit(identity, { family: null, profileHash: identity.profileHash, claims, ...(holds.length === 0 ? {} : { holds }) }, work);
}
/** The same check without a write: a fail-fast refusal before work whose admission must wait for its operation ID. */
export async function assertClaimsAvailable(state, profileHash, claims) {
    await new OperationIndex(state).assertAvailable({ family: null, profileHash, claims });
}
/**
 * The approve-time account guard of a saved operation outside the OperationService facade, called right before its own
 * approve or execute starts the effect (QA F03): an entry the index let go by the wall clock (a never-started record
 * past its deadline plus the unstarted margin) while its record is open again by its family's rule (the clock went back)
 * is admitted again, refused with APN_OPERATION_BLOCKED and left released while another unresolved operation holds one
 * of its accounts. An entry that held its claims since its admission passes. `options` carry the family's admission
 * tag and the quarantines its admission waited for. Nothing is written to the family's record.
 */
export async function assertOwnClaimsAvailable(state, operationId, options = {}) {
    await new OperationIndex(state).assertOwnClaimsAvailable(operationId, options);
}
//# sourceMappingURL=admission.js.map