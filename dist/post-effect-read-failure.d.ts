/**
 * A read that failed after this command already sent a money effect. The command then answers with the operation's saved
 * state (its sent hashes, phase and next observation step) instead of a bare error, and names the failed read here:
 * the error code, its constant reason and an HTTP status, never a message, URL or provider payload. It records nothing
 * as succeeded or failed on chain; only a later observation decides the effect.
 */
export interface PostEffectReadFailure {
    readonly code: string | null;
    readonly reason: string | null;
    readonly httpStatus: number | null;
}
export declare function postEffectReadFailure(error: unknown): PostEffectReadFailure;
