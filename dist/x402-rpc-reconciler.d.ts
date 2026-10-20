import type { ClockPort, X402RpcPort } from "./ports.js";
import { type X402OperationRecord } from "./x402-state-integrity.js";
export interface X402ReconciliationStore {
    persist(operation: X402OperationRecord): Promise<void>;
}
export interface X402ReconciliationOutcome {
    readonly operation: X402OperationRecord;
    /** True only when this call read authorizationState(wallet, nonce) = false at the current proof (safe or finalized) block. */
    readonly unusedAtSafe: boolean;
}
/**
 * EIP-3009 outcomes come from the token's own nonce state, one header and one eth_call per proof, on any public RPC:
 * - used at a block of the record's proof tag (safe, or finalized off the released chains) means settled: APN signs exactly one TransferWithAuthorization per random nonce and never a
 *   cancellation, so a used nonce is exactly this payment of `value` to `to`;
 * - unused at a finalized block at or after validBefore means it can never settle.
 * A transaction hash from PAYMENT-RESPONSE is recorded only when its receipt carries the matching logs.
 */
export declare class X402RpcReconciler {
    private readonly rpc;
    private readonly clock;
    private readonly store;
    constructor(rpc: X402RpcPort, clock: ClockPort, store: X402ReconciliationStore);
    reconcile(input: X402OperationRecord): Promise<X402ReconciliationOutcome>;
    private matchingTransaction;
    private persist;
}
