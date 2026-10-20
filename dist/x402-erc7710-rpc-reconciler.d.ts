import type { ClockPort, X402RpcPort } from "./ports.js";
import { type X402OperationRecord } from "./x402-state-integrity.js";
export interface Erc7710ReconciliationStore {
    persist(operation: X402OperationRecord): Promise<void>;
}
export declare class X402Erc7710RpcReconciler {
    private readonly rpc;
    private readonly clock;
    private readonly store;
    constructor(rpc: X402RpcPort, clock: ClockPort, store: Erc7710ReconciliationStore);
    reconcile(operation: X402OperationRecord): Promise<X402OperationRecord>;
    private canProveExpiredUnused;
    private reconcileExpiredUnused;
    /**
     * A block at or after the delegation's expiry that closes the scan range. Any such block is sound: the timestamp
     * caveat refuses redemption from it on, and a later bound only widens the scan. Block times are near-constant, so
     * interpolation between the prepared block and the finalized head lands on the first expired block in one header
     * read (was a binary search of ~log2(range) reads plus four rechecks); a guess that falls short of the expiry moves
     * the lower end and tries again, and the finalized head itself is the bound when the reads run out.
     */
    private expiryBound;
    /**
     * True only when the window holds no Transfer of this token from the wallet to the payee, of ANY value. The child
     * delegation caps a cumulative amount ("up to"), so a redemption of less than the amount, or of two parts, is still
     * a redemption: any such Transfer (or a same-payee payment outside this operation) leaves the operation unresolved,
     * with owner abandon as its exit. Every log the port returns already is such a Transfer (its adapter refuses others).
     */
    private scanNoPayeeTransfer;
}
