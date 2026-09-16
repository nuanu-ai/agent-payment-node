/**
 * The single seam between the prepared offer and the batch actually sent. The prepared intent is immutable, so the
 * approved fingerprint never moves; a reprice replaces only the quote and the delegation derived from it.
 */
export function mmDispatchIntent(op) {
    const dispatch = op.dispatch;
    return dispatch === null || dispatch === undefined ? op.intent : { ...op.intent, ...dispatch };
}
/** The quote every post-dispatch proof must match: delivered, fee and debit are read against this one. */
export function mmDispatchedQuote(op) {
    return mmDispatchIntent(op).quote;
}
//# sourceMappingURL=dispatch.js.map