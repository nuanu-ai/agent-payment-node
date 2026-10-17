export const GASZIP_TERMINAL_STATES = ["completed", "failed_before_effect", "failed_confirmed_revert", "destination_failed"];
/** Every state a funding record may hold: its open states, then its outcomes (the record's `terminal` flag must equal membership). */
export const GASZIP_STATES = ["prepared", "signing_started", "sealed", "submitting", "submitted", "unknown_finality", ...GASZIP_TERMINAL_STATES];
/** A source effect that landed stays counted (finalized) even when the destination failed; an unsent one is released. */
export function gaszipUsageState(state) {
    return state === "completed" || state === "destination_failed" ? "finalized" : state;
}
/**
 * A well-formed JSON-RPC error answer to eth_sendRawTransaction is a definite refusal of those bytes, except the answers that
 * say the node already holds them. Transport failures and malformed answers stay ambiguous.
 */
export function gaszipSendRefused(value, id) {
    const error = value.error;
    return value.jsonrpc === "2.0" && value.id === id && !Object.hasOwn(value, "result") && error !== null && typeof error === "object" &&
        Number.isSafeInteger(error.code) && typeof error.message === "string" &&
        !/already known|known transaction|already imported|already exists/iu.test(error.message);
}
/**
 * The one extra read on the absent-transaction path: when the owner's nonce at the safe head is already past the signed
 * nonce, a different transaction used it, so these signed bytes can never land.
 */
export async function gaszipNonceConsumed(rpc, owner, nonce, quantity) {
    return quantity(await rpc.call("eth_getTransactionCount", [owner, "safe"])) > BigInt(nonce);
}
/** The terminal digest of a signed effect that APN retired without it landing; the scrubbed bytes are never sent again. */
export function gaszipUnlandedReason(reason, transactionHash) {
    return { reason, transactionHash };
}
//# sourceMappingURL=gaszip-outcome.js.map