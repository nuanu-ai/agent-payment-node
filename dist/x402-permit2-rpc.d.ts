import type { Address, Hex } from "./model.js";
import type { X402Asset } from "./x402-network.js";
type Call = (method: string, params: readonly unknown[]) => Promise<unknown>;
type Batch = (calls: readonly {
    readonly method: string;
    readonly params: readonly unknown[];
}[]) => Promise<readonly unknown[]>;
/** What prepare proves for a Permit2 offer, all at one block of the asset's proof tag. */
export interface X402Permit2PrepareEvidence {
    readonly address: Address;
    /** The token balance (the field name is shared with the EIP-3009 evidence). */
    readonly usdcAtomic: string;
    readonly allowanceAtomic: string;
    readonly rpcOriginHash: string;
    readonly observedAt: string;
    readonly queriedTag: "safe" | "finalized";
    readonly block: {
        readonly number: string;
        readonly hash: Hex;
        readonly timestamp: string;
    };
    readonly tokenFacts: {
        readonly decimals: number;
        readonly nonceUnused: true;
    };
    /** Read only when a short allowance needs the seller-sponsored permit: the token's DOMAIN_SEPARATOR and permit nonce. */
    readonly permit?: {
        readonly domainSeparator: Hex;
        readonly nonce: string;
    };
}
/**
 * One header at the proof tag, then one batch pinned to it (EIP-1898): balance, allowance to Permit2, decimals, the
 * Permit2 nonce word of the fresh nonce, and the Permit2 and x402 exact proxy runtimes, which must be the canonical
 * deployments for this chain. A third pinned batch reads the token's domain and permit nonce only when `permitNeeded`.
 */
export declare function readX402Permit2PrepareEvidence(input: {
    readonly call: Call;
    readonly batch: Batch;
    readonly rpcOrigin: string;
    readonly asset: X402Asset;
    readonly address: Address;
    readonly nonce: Hex;
    readonly permitNeeded: (allowanceAtomic: string) => boolean;
}): Promise<X402Permit2PrepareEvidence>;
/** Permit2's unordered nonce bit of `owner` at a block; APN signs one witness transfer per random nonce and never cancels one. */
export declare function readX402Permit2NonceBit(input: {
    readonly call: Call;
    readonly owner: Address;
    readonly nonce: Hex;
    readonly blockNumber: string;
}): Promise<boolean>;
export {};
