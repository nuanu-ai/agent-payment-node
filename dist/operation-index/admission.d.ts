import type { SecureStateStore } from "../secure-state-store.js";
import type { OperationClaim, PrepareIdentity, WantedTag } from "./types.js";
/**
 * Admits a new operation of a family outside the OperationService facade. Its claims are checked and written to the
 * operation index as one step before `work` (the family's prepare body: RPC reads, signing material, the durable record)
 * runs, and removed when `work` fails or writes no record. `holds` are held besides `claims` but never waited for.
 */
export declare function admitOperation<T>(state: SecureStateStore, identity: PrepareIdentity, claims: readonly OperationClaim[], work: () => Promise<T>, holds?: readonly OperationClaim[]): Promise<T>;
/** The same check without a write: a fail-fast refusal before work whose admission must wait for its operation ID. */
export declare function assertClaimsAvailable(state: SecureStateStore, profileHash: string, claims: readonly OperationClaim[]): Promise<void>;
/**
 * The approve-time account guard of a saved operation outside the OperationService facade, called right before its own
 * approve or execute starts the effect (QA F03): an entry the index let go by the wall clock (a never-started record
 * past its deadline plus the unstarted margin) while its record is open again by its family's rule (the clock went back)
 * is admitted again, refused with APN_OPERATION_BLOCKED and left released while another unresolved operation holds one
 * of its accounts. An entry that held its claims since its admission passes. `options` carry the family's admission
 * tag and the quarantines its admission waited for. Nothing is written to the family's record.
 */
export declare function assertOwnClaimsAvailable(state: SecureStateStore, operationId: string, options?: {
    readonly tag?: WantedTag;
    readonly waits?: readonly OperationClaim[];
}): Promise<void>;
