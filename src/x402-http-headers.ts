import { ApnError } from "./errors.js";

const MAX_HEADER_PAIRS = 64;
const MAX_HEADER_NAME_BYTES = 256;
const MAX_CONTROL_VALUE_BYTES = 64 * 1024;
const MAX_AGGREGATE_HEADER_BYTES = 96 * 1024;
const PAYMENT_RESPONSE_HEADERS = new Set(["payment-response", "x-payment-response"]);
export const CONTROL_HEADERS = new Set(["payment-required", "payment-signature", ...PAYMENT_RESPONSE_HEADERS]);

export type RawHeaderPairs = readonly (readonly [string, string])[];

export function pairRawHeaders(values: readonly string[]): RawHeaderPairs {
  if (values.length % 2 !== 0) throw protocol("Seller raw headers are malformed.");
  const pairs: Array<readonly [string, string]> = [];
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (name === undefined || value === undefined) throw protocol("Seller raw headers are malformed.");
    pairs.push([name, value]);
  }
  return pairs;
}

/**
 * Bounds every header and keeps each x402 control header single and canonical. On a paid response (`paid`) the seller's
 * PAYMENT-RESPONSE copies are not judged here: the response is read whole and {@link paymentResponseHeader} decides
 * whether they make one settlement hint, so a malformed hint never costs the paid body.
 */
export function validateRawHeaders(pairs: RawHeaderPairs, paid = false): void {
  if (pairs.length > MAX_HEADER_PAIRS) throw protocol("Seller returned too many headers.");
  let aggregate = 0;
  const controlCounts = new Map<string, number>();
  for (const [name, value] of pairs) {
    const nameBytes = Buffer.byteLength(name, "ascii");
    const valueBytes = Buffer.byteLength(value, "utf8");
    aggregate += nameBytes + valueBytes;
    if (nameBytes === 0 || nameBytes > MAX_HEADER_NAME_BYTES || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) {
      throw protocol("Seller header name is invalid.");
    }
    const normalizedName = name.toLowerCase();
    if (!CONTROL_HEADERS.has(normalizedName) || paid && PAYMENT_RESPONSE_HEADERS.has(normalizedName)) continue;
    if (valueBytes > MAX_CONTROL_VALUE_BYTES) throw protocol("x402 control header exceeds the size limit.");
    if (value.trim() !== value || value.includes(",")) throw protocol("x402 control header is folded or non-canonical.");
    const semanticName = PAYMENT_RESPONSE_HEADERS.has(normalizedName) ? "payment-response" : normalizedName;
    const count = (controlCounts.get(semanticName) ?? 0) + 1;
    if (count > 1) throw protocol(`Seller response contains duplicate ${semanticName} headers.`);
    controlCounts.set(semanticName, count);
  }
  if (aggregate > MAX_AGGREGATE_HEADER_BYTES) throw protocol("Seller headers exceed the aggregate size limit.");
}

export function singleControlHeader(pairs: RawHeaderPairs, name: string): string {
  const value = optionalSingleHeader(pairs, name);
  if (value === undefined) throw protocol(`Seller response requires exactly one ${name.toUpperCase()} header.`);
  if (value.trim() !== value || value.includes(",")) throw protocol("x402 control header is folded or non-canonical.");
  return value;
}

export function optionalSingleHeader(pairs: RawHeaderPairs, name: string): string | undefined {
  const values = pairs.filter(([candidate]) => candidate.toLowerCase() === name).map(([, value]) => value);
  if (values.length > 1) throw protocol(`Seller response contains duplicate ${name} headers.`);
  return values[0];
}

/**
 * The seller's PAYMENT-RESPONSE (or its X-PAYMENT-RESPONSE alias) as one settlement hint. Several copies count as one
 * only when every copy is byte-identical. Copies that differ, a folded or padded value, bytes outside printable ASCII or
 * an oversized value are no hint at all (undefined). Either way the paid body beside it is kept: settlement is proven
 * on chain, never by this header.
 */
export function paymentResponseHeader(pairs: RawHeaderPairs): string | undefined {
  const values = pairs.filter(([name]) => PAYMENT_RESPONSE_HEADERS.has(name.toLowerCase())).map(([, value]) => value);
  const first = values[0];
  if (first === undefined || values.some((value) => value !== first)) return undefined;
  return Buffer.byteLength(first, "utf8") <= MAX_CONTROL_VALUE_BYTES && /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/u.test(first) &&
    !first.includes(",") ? first : undefined;
}

export function requireAsciiControl(value: string, name: string): void {
  if (!/^[\x20-\x7e]+$/u.test(value)) throw protocol(`${name} must be exact ASCII.`);
}

function protocol(message: string): ApnError {
  return new ApnError("APN_HTTP_PROTOCOL", message);
}
