import {
  ALL_METAMASK_FACILITATOR_ADDRESSES,
  METAMASK_FACILITATOR_ADDRESSES,
} from "@metamask/7715-permission-types";
import { exactKeys, isPlainRecord } from "./canonical.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

export function canonicalErc7710Facilitators(
  extra: Readonly<Record<string, unknown>>,
): readonly string[] | null {
  const allowed = new Set([
    "assetTransferMethod", "facilitatorAddresses", "name", "version", "decimals", "paymentFlow",
  ]);
  if (
    extra.assetTransferMethod !== "erc7710" || Object.keys(extra).some((key) => !allowed.has(key)) ||
    !optionalBoundedString(extra.name) || !optionalBoundedString(extra.version) ||
    (extra.decimals !== undefined && extra.decimals !== 6) ||
    (extra.paymentFlow !== undefined && extra.paymentFlow !== "authorization")
  ) return null;
  const value = extra.facilitatorAddresses;
  if (value === undefined) return normalizeAddresses(ALL_METAMASK_FACILITATOR_ADDRESSES);
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return null;
  return normalizeAddresses(value);
}

export function frozenErc7710FacilitatorsMatch(
  extra: Readonly<Record<string, unknown>>,
  frozen: unknown,
): boolean {
  if (!Array.isArray(frozen)) return false;
  const normalizedFrozen = normalizeAddresses(frozen);
  if (normalizedFrozen === null) return false;
  if (extra.facilitatorAddresses !== undefined) {
    if (!Array.isArray(extra.facilitatorAddresses)) return false;
    const normalizedDeclared = normalizeAddresses(extra.facilitatorAddresses);
    return normalizedDeclared !== null && sameAddresses(normalizedFrozen, normalizedDeclared);
  }
  const current = normalizeAddresses(ALL_METAMASK_FACILITATOR_ADDRESSES);
  const legacy = normalizeAddresses(METAMASK_FACILITATOR_ADDRESSES);
  return (current !== null && sameAddresses(normalizedFrozen, current)) ||
    (legacy !== null && sameAddresses(normalizedFrozen, legacy));
}

function normalizeAddresses(value: readonly unknown[]): readonly string[] | null {
  const normalized: string[] = [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !ADDRESS.test(item) || /^0x0{40}$/iu.test(item)) return null;
    const address = item.toLowerCase();
    if (unique.has(address)) return null;
    unique.add(address);
    normalized.push(address);
  }
  return normalized.sort();
}

function sameAddresses(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function optionalBoundedString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 128);
}

export function isStrictErc7710Payload(value: unknown): value is {
  readonly delegationManager: string;
  readonly permissionContext: string;
  readonly delegator: string;
} {
  return isPlainRecord(value) && exactKeys(value, ["delegationManager", "permissionContext", "delegator"]) &&
    typeof value.delegationManager === "string" && ADDRESS.test(value.delegationManager) &&
    !/^0x0{40}$/iu.test(value.delegationManager) && typeof value.delegator === "string" &&
    ADDRESS.test(value.delegator) && !/^0x0{40}$/iu.test(value.delegator) &&
    typeof value.permissionContext === "string" && /^0x(?:[0-9a-fA-F]{2})+$/u.test(value.permissionContext);
}
