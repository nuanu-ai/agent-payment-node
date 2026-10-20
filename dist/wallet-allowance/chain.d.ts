import { type Hex } from "viem";
import type { Address } from "../model.js";
import type { WalletAllowanceRevokeRecord, WalletAllowanceRevokeTerms } from "./model.js";
export interface WalletAllowanceRpc {
    /** One read-only JSON-RPC batch on the chain's explicit endpoint, no retry. */
    batch(calls: readonly {
        readonly method: string;
        readonly params: readonly unknown[];
    }[]): Promise<readonly unknown[]>;
    /** eth_sendRawTransaction, once; an unclear answer is ambiguous and the operation stays `submitted`. */
    send(raw: Hex): Promise<Hex>;
}
/** The only call this family ever signs: approve(spender, 0). */
export declare const revokeData: (spender: Address) => Hex;
/** The allowance at one block: the latest header first, then the read pinned to it (EIP-1898). */
export declare function readAllowanceAt(rpc: WalletAllowanceRpc, input: {
    readonly chainId: number;
    readonly owner: Address;
    readonly token: Address;
    readonly spender: Address;
}): Promise<{
    readonly allowanceAtomic: string;
    readonly blockNumber: string;
    readonly blockHash: Hex;
}>;
export interface WalletAllowanceRevokeRead {
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
 * so no other transaction of this account is in flight), the current allowance, the native balance, the token's code and
 * an estimate of exactly this revoke.
 */
export declare function readRevokePrepare(rpc: WalletAllowanceRpc, input: {
    readonly chainId: number;
    readonly owner: Address;
    readonly token: Address;
    readonly spender: Address;
}): Promise<WalletAllowanceRevokeRead>;
/** The sealed bytes must be exactly the frozen approve(spender, 0), signed by the owner. */
export declare function verifyRevokeRaw(terms: WalletAllowanceRevokeTerms, raw: Hex): Promise<Hex>;
export type RevokeObservation = {
    readonly kind: "receipt";
    readonly outcome: NonNullable<WalletAllowanceRevokeRecord["outcome"]> & {
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
 * the token's Approval(owner, spender, 0) log or the allowance read at the tag equal to zero. Without a receipt, the shared
 * never-lands rule decides (finalized nonce past, the node indexing the era block, the transaction unknown).
 */
export declare function observeRevoke(rpc: Pick<WalletAllowanceRpc, "batch">, record: WalletAllowanceRevokeRecord, now: Date): Promise<RevokeObservation>;
