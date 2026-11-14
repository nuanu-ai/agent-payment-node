import type { SecureStateStore } from "../secure-state-store.js";
import { OperationIndex } from "./index.js";
import type { OperationClaim, PrepareIdentity, WantedTag } from "./types.js";

/**
 * Admits a new operation of a family outside the OperationService facade. Its claims are checked and written to the
 * operation index as one step before `work` (the family's prepare body: RPC reads, signing material, the durable record)
 * runs, and removed when `work` fails or writes no record. `holds` are held besides `claims` but never waited for.
 */
export async function admitOperation<T>(state: SecureStateStore, identity: PrepareIdentity, claims: readonly OperationClaim[],
  work: () => Promise<T>, holds: readonly OperationClaim[] = []): Promise<T> {
  return await new OperationIndex(state).admit(identity,
    { family: null, profileHash: identity.profileHash, claims, ...(holds.length === 0 ? {} : { holds }) }, work);
}

/** The same check without a write: a fail-fast refusal before work whose admission must wait for its operation ID. */
export async function assertClaimsAvailable(state: SecureStateStore, profileHash: string, claims: readonly OperationClaim[]): Promise<void> {
  await new OperationIndex(state).assertAvailable({ family: null, profileHash, claims });
}

/**
 * The approve-time account guard of a saved operation outside the OperationService facade, called right before its own
 * approve or execute starts the effect (QA F03): an entry the index let go by the wall clock (a never-started record
 * past its deadline plus the unstarted margin) holds its claims again if the clock went back, and any other unresolved
 * operation on its accounts refuses it with APN_OPERATION_BLOCKED. Nothing is written to the family's record.
 */
export async function assertOwnClaimsAvailable(state: SecureStateStore, operationId: string, tag?: WantedTag): Promise<void> {
  await new OperationIndex(state).assertOwnClaimsAvailable(operationId, tag);
}
