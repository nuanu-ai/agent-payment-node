import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { decodeCanonicalBase64Json } from "./x402-codec.js";

const HASH = /^[a-f0-9]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function canonicalText(value: unknown, maxBytes = 48 * 1024): unknown {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) stateCorrupt("x402 protected canonical JSON is invalid.");
  const parsed = decodeCanonicalBase64Json(Buffer.from(value, "utf8").toString("base64"));
  if (canonicalJson(parsed) !== value) stateCorrupt("x402 protected JSON is not canonical.");
  return parsed;
}
export function record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) stateCorrupt("x402 state member is not an object.");
  return value;
}
export function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const output = record(value);
  if (!exactKeys(output, keys)) stateCorrupt("x402 state member has an unexpected schema.");
  return output;
}
export function allowedRecord(value: unknown, required: readonly string[], optional: readonly string[]): Record<string, unknown> {
  const output = record(value);
  allowedKeys(output, required, optional);
  return output;
}
export function allowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) stateCorrupt("x402 operation has an unexpected schema.");
}
export function hash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) stateCorrupt("x402 hash is invalid.");
}
export function address(value: unknown): asserts value is `0x${string}` {
  if (typeof value !== "string" || !ADDRESS.test(value) || /^0x0{40}$/u.test(value)) stateCorrupt("x402 address is invalid.");
}
export function bytes32(value: unknown): asserts value is `0x${string}` {
  if (typeof value !== "string" || !BYTES32.test(value)) stateCorrupt("x402 bytes32 is invalid.");
}
export function transactionHash(value: unknown): asserts value is `0x${string}` {
  bytes32(value);
  if (/^0x0{64}$/u.test(value)) stateCorrupt("x402 transaction hash is zero.");
}
export function uint(value: unknown): asserts value is string {
  try { parseAtomic(value); } catch { stateCorrupt("x402 unsigned integer is invalid."); }
}
export function positive(value: unknown): asserts value is string {
  try { parseAtomic(value, { positive: true }); } catch { stateCorrupt("x402 positive integer is invalid."); }
}
export function mediaType(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || Buffer.byteLength(value, "utf8") > 128 ||
    (value !== "application/json" && !/^text\/[!#$%&'*+\-.^_`|~0-9a-z]+$/u.test(value))
  ) stateCorrupt("x402 media type is invalid.");
}
export function timestamp(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) stateCorrupt("x402 timestamp is invalid.");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) stateCorrupt("x402 timestamp is invalid.");
}
export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
export function stateCorrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
