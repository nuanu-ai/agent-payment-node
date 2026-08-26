import { ApnError } from "./errors.js";

const ATOMIC = /^(0|[1-9][0-9]*)$/;
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]*[1-9]))?$/;

export function parseAtomic(value: unknown, options: { positive?: boolean } = {}): bigint {
  if (typeof value !== "string" || !ATOMIC.test(value)) {
    throw new ApnError("APN_INVALID_INPUT", "Atomic money must be a canonical unsigned integer string.");
  }
  const parsed = BigInt(value);
  if (options.positive === true && parsed === 0n) {
    throw new ApnError("APN_INVALID_INPUT", "Money must be greater than zero.");
  }
  return parsed;
}

export function parseDecimal(
  value: unknown,
  decimals: number,
  options: { positive?: boolean } = {},
): { atomic: string; decimal: string } {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new ApnError("APN_INVALID_INPUT", "Money must be a canonical decimal string.");
  }
  const parts = value.split(".");
  const whole = parts[0] ?? "";
  const fraction = parts[1] ?? "";
  if (fraction.length > decimals) {
    throw new ApnError("APN_INVALID_INPUT", "Money has more precision than the asset supports.");
  }
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (options.positive === true && atomic === 0n) {
    throw new ApnError("APN_INVALID_INPUT", "Money must be greater than zero.");
  }
  return { atomic: atomic.toString(), decimal: value };
}

export function formatAtomic(value: string, decimals: number): string {
  const parsed = parseAtomic(value);
  const scale = 10n ** BigInt(decimals);
  const whole = parsed / scale;
  const fraction = (parsed % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

export function multiplyAtomic(a: string, b: string): string {
  return (parseAtomic(a) * parseAtomic(b)).toString();
}
