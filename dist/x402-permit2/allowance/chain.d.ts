import { type Hex } from "viem";
import type { Address } from "../../model.js";
import type { Permit2AllowanceRecord, Permit2AllowanceTerms } from "./model.js";
export interface Permit2AllowanceRpc {
    readonly origin: string;
    /** One read-only JSON-RPC batch on the owner's explicit endpoint, no retry. */
    batch(calls: readonly {
        readonly method: string;
        readonly params: readonly unknown[];
    }[]): Promise<readonly unknown[]>;
    /** eth_sendRawTransaction, once; an unclear answer is ambiguous and the operation stays `submitted`. */
    send(raw: Hex): Promise<Hex>;
}
export declare const permit2ApproveData: (amountAtomic: string) => Hex;
export interface Permit2AllowancePrepareRead {
    readonly era: {
        readonly number: string;
        readonly hash: Hex;
    };
    readonly baseFeeWei: bigint;
    readonly nonce: string;
    readonly allowanceAtomic: string;
    readonly nativeBalanceWei: bigint;
    readonly gasEstimate: bigint;
}
/**
 * The latest header first, then one batch pinned to it (EIP-1898): the owner's nonce (which must equal the pending one,
 * so no other transaction of this account is in flight), the token's current allowance to Permit2, the native balance,
 * the token's code and an estimate of exactly this approve.
 */
export declare function readPermit2AllowancePrepare(rpc: Permit2AllowanceRpc, input: {
    readonly chainId: number;
    readonly owner: Address;
    readonly token: Address;
    readonly amountAtomic: string;
}): Promise<Permit2AllowancePrepareRead>;
/** The sealed bytes must be exactly the frozen approve, signed by the owner. */
export declare function verifyPermit2AllowanceRaw(terms: Permit2AllowanceTerms, raw: Hex): Promise<Hex>;
export type Permit2AllowanceObservation = {
    readonly kind: "receipt";
    readonly outcome: NonNullable<Permit2AllowanceRecord["outcome"]> & {
        readonly kind: "receipt";
    };
} | {
    readonly kind: "never_lands";
    readonly finalizedNonce: string;
} | {
    readonly kind: "pending";
    readonly reason: string;
};
/**
 * A receipt counts once its block is at or below the chain's proof tag and is that height's canonical block; success needs
 * the token's Approval(owner, Permit2, amount) log or the allowance read at the tag equal to the amount. Without a receipt,
 * the shared never-lands rule decides (finalized nonce past, the node indexing the era block, the transaction unknown).
 */
export declare function observePermit2Allowance(rpc: Permit2AllowanceRpc, record: Permit2AllowanceRecord, now: Date): Promise<Permit2AllowanceObservation>;
