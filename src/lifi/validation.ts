import { getAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError, type ErrorCode, type ErrorDetails } from "../errors.js";
import type { Address, Hex } from "../model.js";

export const BRIDGE_MAX_CALLDATA_BYTES = 12 * 1024;
export const BRIDGE_MAX_SIGNED_BYTES = 16 * 1024;
export const BRIDGE_MAX_GAS = 5_000_000n;
export const BRIDGE_TTL_MS = 300_000;
export const BRIDGE_MIN_REMAINING_MS = 15_000;
/**
 * The stated EIP-1559 price headroom the owner approves with the intent. A bridge is priced at preparation and
 * signed later, so the approved maximum is the quoted price raised by exactly this many basis points; the frozen
 * envelope, the signature, the native debit cap check and the approval disclosure all use that maximum. There is
 * no other multiplier anywhere in the rail, and a fresh estimate above the maximum is refused, never repriced.
 */
export const BRIDGE_FEE_HEADROOM_POLICY = "apn.bridge-fee-headroom.v1" as const;
export const BRIDGE_FEE_HEADROOM_BPS = 5_000;
export const BRIDGE_DIAMOND = getAddress("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE");
export const BRIDGE_ZERO_ADDRESS = `0x${"0".repeat(40)}` as Address;
export const BRIDGE_ZERO_WORD = `0x${"0".repeat(64)}` as Hex;
const MAX_UINT = (1n << 256n) - 1n;

export function bridgeFailure(code: ErrorCode, reason: string, details?: ErrorDetails): never {
  throw new ApnError(code, `Bridge validation failed: ${reason}.`, details === undefined ? undefined : { reason, ...details });
}
export function bridgeRecord(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): Record<string, unknown> {
  if (!isPlainRecord(value)) bridgeFailure(code, "object_required");
  return value;
}
export function bridgeExact(value: unknown, keys: readonly string[], code: ErrorCode = "APN_STATE_CORRUPT"): Record<string, unknown> {
  const result = bridgeRecord(value, code);
  if (!exactKeys(result, keys)) bridgeFailure(code, "record_fields");
  return result;
}
export function bridgeUint(value: unknown, positive = false, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value)) bridgeFailure(code, "atomic_integer");
  const result = BigInt(value);
  if (result > MAX_UINT || (positive && result === 0n)) bridgeFailure(code, "integer_bound");
  return result;
}
export function bridgeAddress(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) bridgeFailure(code, "address_shape");
  try { return getAddress(value); } catch { return bridgeFailure(code, "address_checksum"); }
}
export function bridgeHex(value: unknown, maxBytes = BRIDGE_MAX_CALLDATA_BYTES, exactBytes?: number, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) || value.length > 2 + maxBytes * 2 ||
    (exactBytes !== undefined && value.length !== 2 + exactBytes * 2)) bridgeFailure(code, "bounded_hex");
  return value.toLowerCase() as Hex;
}
export function bridgeHash(value: unknown, code: ErrorCode = "APN_STATE_CORRUPT"): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) bridgeFailure(code, "hash_identity");
  return value;
}
export function bridgeOpaque(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u.test(value)) bridgeFailure(code, "bounded_identifier");
  return value;
}
export function bridgeIso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) bridgeFailure("APN_STATE_CORRUPT", "timestamp");
  return value;
}
export function bridgeJson(value: string, maxBytes: number): unknown {
  if (Buffer.byteLength(value, "utf8") > maxBytes) bridgeFailure("APN_PROVIDER_PROTOCOL", "response_size");
  try { return JSON.parse(value) as unknown; } catch { return bridgeFailure("APN_PROVIDER_PROTOCOL", "JSON_shape"); }
}
export function bridgeSame(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
/**
 * Raises one quoted wei price to the owner-approved maximum by exactly BRIDGE_FEE_HEADROOM_BPS, rounding up so the
 * maximum is never below the quote. This is the only place the headroom is applied.
 */
export function bridgeHeadroomWei(quotedWei: string, code: ErrorCode = "APN_RPC_PROTOCOL"): string {
  const quoted = bridgeUint(quotedWei, false, code);
  return ((quoted * BigInt(10_000 + BRIDGE_FEE_HEADROOM_BPS) + 9_999n) / 10_000n).toString();
}
