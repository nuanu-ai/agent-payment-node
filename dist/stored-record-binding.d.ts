/**
 * Widen-only validation of stored, hash-sealed records (OWNR 5.1, 5.2). A reader checks what was written, never what
 * the current code would write today, so a changed route constant may refuse NEW prepares but never voids a record:
 *
 * 1. exact keys and the seal recomputed over the STORED body (`sealedStoredRecord`);
 * 2. identity fields equal the operation's OWN recorded custody or account, not an owner constant (`assertStoredFieldsEqual`);
 * 3. protocol fields come from the current route table or from a frozen legacy table for old references (`protocolRow`).
 *
 * Typical replacements:
 * - `validateCircleFundingBinding`: seal `bindingHash` over the stored binding, then compare `sourceOwner` with
 *   `op.sourceCustody.walletAddress`, `gasPayer` with `op.destinationCustody.walletAddress`, and the chain, domain, token
 *   and mechanism with `protocolRow(String(binding.destinationChain), ROUTES, LEGACY_ROUTES)`; never `circleRoute(...)`.
 * - `relayNativeRoute(sourceAccount, recipient)`: `protocolRow(op.nativeQuote.routeReference, ROUTES, LEGACY_ROUTES)`, then
 *   compare its chains with the stored operation; payer and recipient are compared with the operation's own fields.
 * - merchant `custody.walletAddress !== MERCHANT_OWNER`: `assertStoredFieldsEqual(o.custody, { profileHash: o.profileHash }, ...)`
 *   after `validateEvmNativeCustody(o.custody)`; the payer is the stored custody, not a literal.
 *
 * Every helper reports through the caller's `fail(reason)`, so each family keeps its own error code and wording.
 */
export type StoredRecordFailure = (reason: StoredRecordFailureReason) => never;
export type StoredRecordFailureReason = "stored_record_shape" | "stored_record_seal" | "stored_record_binding";
export interface SealedRecordSpec {
    /** Keys every stored version has, including the seal field. */
    readonly keys: readonly string[];
    /** Keys a stored version may carry; each is accepted only when present (widening adds keys here, never to `keys`). */
    readonly optionalKeys?: readonly string[];
    /** The field holding the seal, e.g. `integrityHash`, `bindingHash`, `quoteDigest`. */
    readonly sealField: string;
    /** The family's own seal function over the body without the seal field, e.g. `hashObject` or a domain hash. */
    readonly seal: (body: Readonly<Record<string, unknown>>) => string;
}
/** Steps 1 and 2: exact stored keys and the stored seal recomputed over the stored body. Returns the record unchanged. */
export declare function sealedStoredRecord<T>(value: unknown, spec: SealedRecordSpec, fail: StoredRecordFailure): T;
/**
 * Every expected field must equal the stored one. Pass the operation's own record (its custody, account, recipient)
 * or a protocol table row, never an owner constant. EVM addresses compare case-insensitively, because some records
 * store the lowercase form and others the checksum form of the same address; everything else compares canonically.
 */
export declare function assertStoredFieldsEqual(stored: unknown, expected: Readonly<Record<string, unknown>>, fail: StoredRecordFailure): void;
/**
 * Step 3: the protocol row a stored record names. Current rows serve new prepares and old records alike; a frozen
 * legacy row (an owner-named reference, a retired route) serves only records that already name it. Null when unknown.
 */
export declare function protocolRow<T>(key: string, current: Readonly<Record<string, T>>, legacy?: Readonly<Record<string, T>>): {
    readonly row: T;
    readonly legacy: boolean;
} | null;
