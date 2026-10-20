import { type UniswapTokenAttempt, type UniswapTokenOperation } from "./token-operation.js";
import { type TokenRpcCall } from "./token-rpc.js";
/** What the finalized chain shows for the cleanup that took the swap marker's nonce. */
export interface TokenNonceConsumption {
    readonly finalizedNonce: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly finalizedBlockNumber: string;
}
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
 * One primary batch, so one node answers all three: the account's nonce at the finalized tag, the cleanup transaction by
 * its own hash, and the finalized head. Proven only when that node has the cleanup (signed by the account, chain 1, the
 * swap marker's nonce) in a block at or below the finalized head and the finalized nonce is past it: the finalized chain
 * then holds this cleanup at that nonce, so no transaction of the swap with it can ever be included. Anything else (an
 * unknown or pending cleanup, a head not yet past it) proves nothing and returns null; no state is read at an old block.
 */
export declare function readSwapNonceConsumption(call: TokenRpcCall, op: UniswapTokenOperation, cleanup: UniswapTokenAttempt): Promise<TokenNonceConsumption | null>;
