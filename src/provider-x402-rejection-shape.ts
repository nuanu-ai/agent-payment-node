import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { isProtectedNormalizedProviderKey } from "./normalized-provider-json.js";

const MAX_SAMPLED_KEYS = 64;
const MAX_REPORTED_LENGTH = 262_144;
const CONFLICTING_COMPACT_KEYS = new Set([
  "status", "statustext", "data", "paymentmade", "amountpaid", "httpstatus",
  "httpstatuscode", "statuscode", "amountpaidatomic", "paidamount", "result",
  "response", "payload", "body", "sellerresult",
]);
const CONFLICTING_FRAGMENTS = [
  "amount", "body", "paid", "payment", "payload", "response", "result", "seller", "status",
] as const;
const CONFLICTING_WORDS = new Set([
  "amount", "body", "data", "paid", "payment", "payload", "response", "result", "seller", "status",
]);

export const PROVIDER_X402_KNOWN_ENVELOPE_KEYS = [
  "status", "statusText", "data", "paymentMade", "amountPaid",
] as const;

type KnownEnvelopeKey = typeof PROVIDER_X402_KNOWN_ENVELOPE_KEYS[number];
type JsonValueType = "null" | "boolean" | "number" | "string" | "array" | "object";
type RootType = "invalid_json" | JsonValueType;

export interface ProviderX402RejectionShapeField {
  readonly name: KnownEnvelopeKey;
  readonly value_type: JsonValueType;
  readonly length: string;
}

export interface ProviderX402RejectionShape {
  readonly schema_version: "apn.provider-x402.rejection-shape.v1";
  readonly root_type: RootType;
  readonly known_fields: readonly ProviderX402RejectionShapeField[];
  readonly sampled_key_count: string;
  readonly sampled_unknown_key_count: string;
  readonly sampled_protected_key_count: string;
  readonly sampled_conflicting_alias_count: string;
  readonly truncated: boolean;
  readonly shape_sha256: string;
}

export function providerX402RejectionShape(bytes: Buffer): ProviderX402RejectionShape {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { return seal("invalid_json", [], [], false); }
  if (!isPlainRecord(value)) return seal(valueType(value), [], [], false);

  const keys = Object.keys(value);
  const sampled = keys.slice(0, MAX_SAMPLED_KEYS);
  const unknown = sampled.filter((key) => !isKnownEnvelopeKey(key));
  const knownFields = PROVIDER_X402_KNOWN_ENVELOPE_KEYS
    .filter((name) => Object.hasOwn(value, name))
    .map((name) => shapeField(name, value[name]));
  return seal("object", knownFields, sampled, keys.length > MAX_SAMPLED_KEYS, {
    unknown: unknown.length,
    protected: unknown.filter(isProtectedNormalizedProviderKey).length,
    conflicting: unknown.filter(isConflictingProviderX402OuterKey).length,
  });
}

export function validateProviderX402RejectionShape(value: unknown): ProviderX402RejectionShape {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "schema_version", "root_type", "known_fields", "sampled_key_count",
    "sampled_unknown_key_count", "sampled_protected_key_count",
    "sampled_conflicting_alias_count", "truncated", "shape_sha256",
  ])) invalid();
  const shape = value as unknown as ProviderX402RejectionShape;
  const { shape_sha256: _hash, ...base } = shape;
  const rootTypes: readonly RootType[] = [
    "invalid_json", "null", "boolean", "number", "string", "array", "object",
  ];
  if (
    shape.schema_version !== "apn.provider-x402.rejection-shape.v1" ||
    !rootTypes.includes(shape.root_type) || !Array.isArray(shape.known_fields) ||
    shape.known_fields.length > PROVIDER_X402_KNOWN_ENVELOPE_KEYS.length ||
    typeof shape.truncated !== "boolean" || shape.shape_sha256 !== hashObject(base)
  ) invalid();
  const counts = [
    shape.sampled_key_count, shape.sampled_unknown_key_count,
    shape.sampled_protected_key_count, shape.sampled_conflicting_alias_count,
  ].map(boundedCount);
  const sampledKeyCount = counts[0];
  if (sampledKeyCount === undefined || counts.slice(1).some((count) => count > sampledKeyCount)) invalid();
  const names = shape.known_fields.map((field) => validateField(field));
  const expectedOrder = PROVIDER_X402_KNOWN_ENVELOPE_KEYS.filter((name) => names.includes(name));
  if (canonicalJson(names) !== canonicalJson(expectedOrder)) invalid();
  if (shape.root_type !== "object" && (
    names.length !== 0 || counts.some((count) => count !== 0) || shape.truncated
  )) invalid();
  return shape;
}

export function isConflictingProviderX402OuterKey(key: string): boolean {
  const compact = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  if (CONFLICTING_COMPACT_KEYS.has(compact)) return true;
  if (compact.startsWith("data") || CONFLICTING_FRAGMENTS.some((fragment) => compact.includes(fragment))) return true;
  const words = key.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^a-z0-9]+/iu).filter((word) => word.length > 0).map((word) => word.toLowerCase());
  return words.some((word) => CONFLICTING_WORDS.has(word));
}

function seal(
  rootType: RootType,
  knownFields: readonly ProviderX402RejectionShapeField[],
  sampledKeys: readonly string[],
  truncated: boolean,
  counts = { unknown: 0, protected: 0, conflicting: 0 },
): ProviderX402RejectionShape {
  const base = {
    schema_version: "apn.provider-x402.rejection-shape.v1" as const,
    root_type: rootType,
    known_fields: knownFields,
    sampled_key_count: sampledKeys.length.toString(),
    sampled_unknown_key_count: counts.unknown.toString(),
    sampled_protected_key_count: counts.protected.toString(),
    sampled_conflicting_alias_count: counts.conflicting.toString(),
    truncated,
  };
  return { ...base, shape_sha256: hashObject(base) };
}

function shapeField(name: KnownEnvelopeKey, value: unknown): ProviderX402RejectionShapeField {
  const type = valueType(value);
  const rawLength = type === "string" ? Buffer.byteLength(value as string, "utf8")
    : type === "array" ? (value as unknown[]).length
      : type === "object" ? Object.keys(value as Record<string, unknown>).length : 0;
  return { name, value_type: type, length: Math.min(rawLength, MAX_REPORTED_LENGTH).toString() };
}

function validateField(value: unknown): KnownEnvelopeKey {
  if (!isPlainRecord(value) || !exactKeys(value, ["name", "value_type", "length"])) invalid();
  const field = value as unknown as ProviderX402RejectionShapeField;
  if (!isKnownEnvelopeKey(field.name) || ![
    "null", "boolean", "number", "string", "array", "object",
  ].includes(field.value_type)) invalid();
  boundedLength(field.length);
  return field.name;
}

function valueType(value: unknown): JsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (["boolean", "number", "string"].includes(typeof value)) return typeof value as JsonValueType;
  return "object";
}

function isKnownEnvelopeKey(value: string): value is KnownEnvelopeKey {
  return (PROVIDER_X402_KNOWN_ENVELOPE_KEYS as readonly string[]).includes(value);
}

function boundedCount(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) invalid();
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count > MAX_SAMPLED_KEYS) invalid();
  return count;
}

function boundedLength(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) invalid();
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > MAX_REPORTED_LENGTH) invalid();
  return length;
}

function invalid(): never { throw new TypeError("Invalid provider x402 rejection shape."); }
