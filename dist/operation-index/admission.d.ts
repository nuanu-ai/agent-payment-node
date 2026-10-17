import type { SecureStateStore } from "../secure-state-store.js";
import type { OperationClaim, PrepareIdentity } from "./types.js";
/**
 * Admits a new operation of a family outside the OperationService facade. Its claims are checked and written to the
 * operation index as one step before `work` (the family's prepare body: RPC reads, signing material, the durable record)
 * runs, and removed when `work` fails or writes no record. `holds` are held besides `claims` but never waited for.
 */
export declare function admitOperation<T>(state: SecureStateStore, identity: PrepareIdentity, claims: readonly OperationClaim[], work: () => Promise<T>, holds?: readonly OperationClaim[]): Promise<T>;
/** The same check without a write: a fail-fast refusal before work whose admission must wait for its operation ID. */
export declare function assertClaimsAvailable(state: SecureStateStore, profileHash: string, claims: readonly OperationClaim[]): Promise<void>;
