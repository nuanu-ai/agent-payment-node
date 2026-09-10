import { getAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError, type ErrorCode } from "../errors.js";
import type { Address, Hex } from "../model.js";
import type { GaslessChainId, GaslessRequest } from "./model.js";

export const GASLESS_CHAINS = [1, 10, 130, 137, 8453, 42161, 43114] as const;
// Keep historical Avalanche records parseable; the admitted bundler path lacks EIP-7702 there.
export const GASLESS_EIP7702_CHAINS: readonly GaslessChainId[] = Object.freeze([1, 10, 130, 137, 8453, 42161]);
export const GASLESS_TTL_MS = 300_000;
export const GASLESS_MIN_REMAINING_MS = 15_000;
export const GASLESS_MAX_UINT = (1n << 256n) - 1n;
export const GASLESS_MAX_UINT120 = (1n << 120n) - 1n;
export const GASLESS_MAX_DATA = 16 * 1024;
export const GASLESS_ZERO_ADDRESS = `0x${"0".repeat(40)}` as Address;
export const GASLESS_FACTORY = getAddress("0x7702000000000000000000000000000000000000");

export function gaslessFailure(code: ErrorCode, reason: string): never {
  throw new ApnError(code, `Gasless validation failed: ${reason}.`);
}
export function gaslessRecord(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): Record<string, unknown> {
  if (!isPlainRecord(value)) gaslessFailure(code, "gasless_record_shape");
  return value;
}
export function gaslessExact(value: unknown, keys: readonly string[], code: ErrorCode = "APN_STATE_CORRUPT"): Record<string, unknown> {
  const r = gaslessRecord(value, code);
  if (!exactKeys(r, keys)) gaslessFailure(code, "gasless_record_fields");
  return r;
}
export function gaslessUint(value: unknown, positive = false, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value)) gaslessFailure(code, "gasless_atomic_integer");
  const n = BigInt(value);
  if (n > GASLESS_MAX_UINT || (positive && n === 0n)) gaslessFailure(code, "gasless_integer_bound");
  return n;
}
export function gaslessDecimal(value: unknown, positive = false): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,71})(?:\.[0-9]{1,6})?$/u.test(value)) gaslessFailure("APN_INVALID_INPUT", "gasless_six_decimal_USDC");
  const [whole, fraction = ""] = value.split(".");
  const n = (BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
  gaslessUint(n, positive, "APN_INVALID_INPUT"); return n;
}
export function gaslessAddress(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) gaslessFailure(code, "gasless_address_shape");
  try { return getAddress(value); } catch { return gaslessFailure(code, "gasless_address_checksum"); }
}
export function gaslessHex(value: unknown, maximum = GASLESS_MAX_DATA, bytes?: number, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) || value.length > 2 + maximum * 2 ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)) gaslessFailure(code, "gasless_bounded_hex");
  return value.toLowerCase() as Hex;
}
export function gaslessHash(value: unknown, code: ErrorCode = "APN_STATE_CORRUPT"): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) gaslessFailure(code, "gasless_hash_identity");
  return value;
}
export function gaslessChain(value: unknown, code: ErrorCode = "APN_INVALID_INPUT"): GaslessChainId {
  if (!GASLESS_CHAINS.includes(value as GaslessChainId)) gaslessFailure(code, "gasless_chain_identity");
  return value as GaslessChainId;
}
export function assertGaslessExecutionChain(chainId: GaslessChainId): void {
  if (!GASLESS_EIP7702_CHAINS.includes(gaslessChain(chainId))) {
    gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_eip7702_unavailable");
  }
}
export function gaslessIso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) gaslessFailure("APN_STATE_CORRUPT", "gasless_timestamp");
  return value;
}
export function gaslessSame(a: unknown, b: unknown): boolean { return canonicalJson(a) === canonicalJson(b); }
export function validateGaslessRequest(value: unknown, code: ErrorCode = "APN_INVALID_INPUT"): GaslessRequest {
  const r = gaslessExact(value, ["chainId", "recipient", "grossAtomic", "maxFeeAtomic", "minReceivedAtomic"], code);
  gaslessChain(r.chainId, code);
  if (gaslessAddress(r.recipient, code) !== r.recipient || r.recipient === GASLESS_ZERO_ADDRESS) gaslessFailure(code, "gasless_recipient");
  const g = gaslessUint(r.grossAtomic, true, code), n = gaslessUint(r.minReceivedAtomic, true, code);
  gaslessUint(r.maxFeeAtomic, false, code);
  if (n > g) gaslessFailure(code, "gasless_minimum_above_gross");
  return r as unknown as GaslessRequest;
}
