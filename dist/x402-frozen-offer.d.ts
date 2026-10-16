/**
 * Binds a saved operation to the seller requirements it froze at prepare, using only that saved JSON: network,
 * asset, amount, payee and the method fields must equal the record's own economics. Returns the frozen
 * maxTimeoutSeconds that fixed validBefore. Admission limits (token map, timeout window, extra fields) belong to
 * prepare and are deliberately not re-applied here.
 */
export declare function frozenOfferTimeout(requirements: unknown, operation: Readonly<Record<string, unknown>>, resolved: Readonly<Record<string, unknown>>): bigint;
