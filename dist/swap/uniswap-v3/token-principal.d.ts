import { type UniswapTokenAttempt, type UniswapTokenOperation, type UniswapTokenSwapNonceProof } from "./token-operation.js";
import { type TokenRpcCall } from "./token-rpc.js";
/** What the finalized chain shows for the cleanup that took the swap marker's nonce. */
export interface TokenNonceConsumption {
    readonly finalizedNonce: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly finalizedBlockNumber: string;
}
/** A finalized block past the route's deadline at which the account's nonce had not yet reached `fromNonce`. */
export type TokenNonceUnused = NonNullable<UniswapTokenSwapNonceProof["unused"]>;
/** The chain reads a principal release spends on its swap markers' nonces. */
export interface TokenSwapNonceReads {
    swapNonceConsumed?(operation: UniswapTokenOperation, cleanup: UniswapTokenAttempt): Promise<TokenNonceConsumption | null>;
    swapNonceUnused?(operation: UniswapTokenOperation, fromNonce: string): Promise<TokenNonceUnused | null>;
}
/**
 * The finalized chain's proof that no swap carrying any of `nonces` (a swap marker's, ascending) can land: a nonce a landed
 * cleanup of this operation took is shown held by it (the cleanup at that nonce in a finalized block); every other nonce is
 * shown unused by one read, the account's finalized nonce at or below the lowest of them at a block past the deadline.
 * Null when either is not proven: the hold then stays.
 */
export declare function proveSwapNoncesUnusable(op: UniswapTokenOperation, nonces: readonly string[], reads: TokenSwapNonceReads): Promise<UniswapTokenSwapNonceProof | null>;
/**
 * One primary batch, so one node answers both: the finalized block, then the account's nonce at the finalized tag. Proven
 * only when that block's timestamp is past the route's deadline (the router refuses the swap in any later block) and the
 * nonce is at or below `fromNonce` (nothing with it, or any higher nonce, was included up to that block). The block is
 * asked first: a node whose finalized tag moves between the two answers can only answer the nonce at a later finalized
 * block, whose nonce is no lower, so the proof still holds at the block read. No state is read at an old block.
 */
export declare function readSwapNonceUnused(call: TokenRpcCall, op: UniswapTokenOperation, fromNonce: string): Promise<TokenNonceUnused | null>;
/**
 * How a cleaned swap whose principal is still held could prove that no swap of it can land: nothing to read when no swap
 * marker is left (never signed), the landed cleanup that reused a hashless swap marker's nonce otherwise; null when the
 * record holds no such proof (a bound or retired swap settles by its own observation, an unrelated nonce proves nothing).
 */
export declare function principalReleaseCandidate(op: UniswapTokenOperation): {
    readonly kind: "swap_never_signed";
} | {
    readonly kind: "swap_nonce_consumed_by_cleanup";
    readonly swap: UniswapTokenAttempt;
    readonly cleanup: UniswapTokenAttempt;
} | null;
/**
 * R4 for an owner-abandoned swap: its abandon keeps the principal held only while an effect of it could still land. With no
 * swap marker nothing of the swap was ever bound; a hashless marker still needs custody to show it never signed (the forward
 * command checks it under the account lock). A bound or retired swap, a receipt or a recorded release: null.
 */
export declare function abandonedPrincipalCandidate(op: UniswapTokenOperation): {
    readonly swap: UniswapTokenAttempt | null;
} | null;
/**
 * One primary batch, so one node answers all three: the account's nonce at the finalized tag, the cleanup transaction by
 * its own hash, and the finalized head. Proven only when that node has the cleanup (signed by the account, chain 1, the
 * swap marker's nonce) in a block at or below the finalized head, the finalized nonce is past it, and the canonical block
 * at the cleanup's height is the one the transaction names (read next on the same primary: the height is known only from
 * the transaction, and a block at or below the finalized head is final): the finalized chain then holds this cleanup at
 * that nonce, so no transaction of the swap with it can ever be included. Anything else (an unknown or pending cleanup, a
 * head not yet past it, another block at its height) proves nothing and returns null; no state is read at an old block.
 */
export declare function readSwapNonceConsumption(call: TokenRpcCall, op: UniswapTokenOperation, cleanup: UniswapTokenAttempt): Promise<TokenNonceConsumption | null>;
