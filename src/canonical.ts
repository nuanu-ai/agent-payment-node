import { createHash } from "node:crypto";
import { ApnError } from "./errors.js";

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonical(value));
}

function toCanonical(value: unknown): Canonical {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(toCanonical);
  if (typeof value === "object") {
    const output: { [key: string]: Canonical } = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      output[key] = toCanonical(item);
    }
    return output;
  }
  throw new ApnError("APN_INVALID_INPUT", "Canonical data contains an unsupported value.");
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function domainHash(domain: string, value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return createHash("sha256").update(domain, "utf8").update(Buffer.from([0])).update(bytes).digest("hex");
}

export function hashObject(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}
