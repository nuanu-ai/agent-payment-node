import { getAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import { MM_CHAINS, MM_MAX_UINT, MM_ZERO_ADDRESS, type MetaMaskGaslessChainId, type MetaMaskGaslessRequest } from "./model.js";
import { mmFail, type MetaMaskGaslessFailureReason } from "./reasons.js";

export function mmExact(value: unknown, keys: readonly string[], reason: MetaMaskGaslessFailureReason = "mm_gasless_state_corrupt"): Record<string, unknown> {
  if (!isPlainRecord(value) || !exactKeys(value, keys)) mmFail(reason);
  return value;
}
export function mmUint(value: unknown, positive = false, reason: MetaMaskGaslessFailureReason = "mm_gasless_input"): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value)) mmFail(reason);
  const parsed = BigInt(value);
  if (parsed > MM_MAX_UINT || (positive && parsed === 0n)) mmFail(reason);
  return parsed;
}
export function mmDecimal(value: unknown, positive = false): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,71})(?:\.[0-9]{1,6})?$/u.test(value)) mmFail("mm_gasless_input");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return mmUint(result.toString(), positive).toString();
}
export function mmFormat(value: string): string {
  const n = mmUint(value), fraction = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${n / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}
export function mmAddress(value: unknown, reason: MetaMaskGaslessFailureReason = "mm_gasless_input"): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) mmFail(reason);
  try { return getAddress(value).toLowerCase() as Address; } catch { return mmFail(reason); }
}
export function mmCanonicalAddress(value: unknown, reason: MetaMaskGaslessFailureReason = "mm_gasless_state_corrupt"): Address {
  const result = mmAddress(value, reason);
  if (result !== value) mmFail(reason);
  return result;
}
export function mmHex(value: unknown, bytes?: number, reason: MetaMaskGaslessFailureReason = "mm_gasless_state_corrupt", maximum = 16_384): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value) || value.length > 2 + maximum * 2 ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)) mmFail(reason);
  return value as Hex;
}
export function mmHash(value: unknown, reason: MetaMaskGaslessFailureReason = "mm_gasless_state_corrupt"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) mmFail(reason);
  return value;
}
export function mmIso(value: unknown, reason: MetaMaskGaslessFailureReason = "mm_gasless_state_corrupt"): string {
  if (typeof value !== "string") mmFail(reason);
  const n = Date.parse(value);
  if (!Number.isSafeInteger(n) || n <= 0 || new Date(n).toISOString() !== value) mmFail(reason);
  return value;
}
export function mmUuid(value: unknown, reason: MetaMaskGaslessFailureReason = "mm_gasless_state_corrupt"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) mmFail(reason);
  return value;
}
export function mmChain(value: unknown): MetaMaskGaslessChainId {
  if (!MM_CHAINS.includes(value as MetaMaskGaslessChainId)) mmFail("mm_gasless_unsupported_chain");
  return value as MetaMaskGaslessChainId;
}
export function mmSame(a: unknown, b: unknown): boolean { return canonicalJson(a) === canonicalJson(b); }
export function mmRequest(value: unknown, reason: MetaMaskGaslessFailureReason = "mm_gasless_input"): MetaMaskGaslessRequest {
  const r = mmExact(value, ["chainId", "recipient", "grossAtomic", "maxFeeAtomic", "minReceivedAtomic"], reason);
  mmChain(r.chainId);
  if (mmCanonicalAddress(r.recipient, reason) === MM_ZERO_ADDRESS) mmFail(reason);
  const gross = mmUint(r.grossAtomic, true, reason), minimum = mmUint(r.minReceivedAtomic, true, reason);
  mmUint(r.maxFeeAtomic, false, reason);
  if (minimum > gross) mmFail(reason);
  return r as unknown as MetaMaskGaslessRequest;
}
