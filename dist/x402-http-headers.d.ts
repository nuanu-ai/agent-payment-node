export declare const CONTROL_HEADERS: Set<string>;
export type RawHeaderPairs = readonly (readonly [string, string])[];
export declare function pairRawHeaders(values: readonly string[]): RawHeaderPairs;
/**
 * Bounds every header and keeps each x402 control header single and canonical. On a paid response (`paid`) the seller's
 * PAYMENT-RESPONSE copies are not judged here: the response is read whole and {@link paymentResponseHeader} decides
 * whether they make one settlement hint, so a malformed hint never costs the paid body.
 */
export declare function validateRawHeaders(pairs: RawHeaderPairs, paid?: boolean): void;
export declare function singleControlHeader(pairs: RawHeaderPairs, name: string): string;
export declare function optionalSingleHeader(pairs: RawHeaderPairs, name: string): string | undefined;
/**
 * The seller's PAYMENT-RESPONSE (or its X-PAYMENT-RESPONSE alias) as one settlement hint. Several copies count as one
 * only when every copy is byte-identical. Copies that differ, a folded or padded value, bytes outside printable ASCII or
 * an oversized value are no hint at all (undefined). Either way the paid body beside it is kept: settlement is proven
 * on chain, never by this header.
 */
export declare function paymentResponseHeader(pairs: RawHeaderPairs): string | undefined;
export declare function requireAsciiControl(value: string, name: string): void;
