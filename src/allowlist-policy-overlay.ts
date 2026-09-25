import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import {
  ALLOWLIST_DATASET_SCHEMA,
  type AllowlistInventory,
  type CandidateKind,
  type CandidateRail,
  loadAllowlistInventory,
  resolveAllowlistAsset,
} from "./allowlist-inventory.js";
import {
  sealAssetPolicyRegistry,
  type AssetPolicyRegistry,
  type AssetRailAdmission,
  type UnsignedAssetPolicyRegistry,
} from "./asset-policy-registry.js";
import { parseAtomic } from "./money.js";
import { stateCorrupt } from "./secure-state-store.js";
import { tronAddress } from "./tron/codec.js";
import { validateSwapMechanismPin, type SwapMechanismPin } from "./swap/pin.js";

export const ALLOWLIST_POLICY_OVERLAY_SCHEMA = "apn.allowlist-policy-overlay.v1" as const;
export const ALLOWLIST_POLICY_RECORD_SCHEMA = "apn.allowlist-policy-record.v1" as const;
const MAX_UINT256 = (1n << 256n) - 1n;
const DIGEST = /^[a-f0-9]{64}$/u;
const PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const PIN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u;

export interface AllowlistMechanismPin {
  readonly provider: string;
  readonly reference: string;
}

export type AllowlistAdmissionMechanismPin = AllowlistMechanismPin | SwapMechanismPin;

export interface AllowlistPolicyAdmissionInput {
  readonly chain: string;
  readonly kind: CandidateKind;
  readonly identifier?: string;
  readonly rail: CandidateRail;
  readonly maximumPerTransferAtomic?: string;
  readonly dailyLimitAtomic: string;
  readonly mechanism?: AllowlistAdmissionMechanismPin;
  /** Bridge only: exact alternative pins, each with its own per-transfer ceiling. */
  readonly mechanisms?: readonly (AllowlistMechanismPin & { readonly maximumPerTransferAtomic: string })[];
}

export interface AllowlistPolicyOverlayInput {
  readonly overlayVersion: string;
  readonly profile: string;
  readonly account: string;
  readonly datasetVersion: string;
  readonly datasetSha256: string;
  readonly inventorySha256: string;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
  readonly admissions: readonly AllowlistPolicyAdmissionInput[];
}

export interface AllowlistPolicyOverlay extends AllowlistPolicyOverlayInput {
  readonly schemaVersion: typeof ALLOWLIST_POLICY_OVERLAY_SCHEMA;
  readonly profileHash: string;
  readonly overlayDigest: string;
}

export interface AllowlistPolicyRecord {
  readonly schemaVersion: typeof ALLOWLIST_POLICY_RECORD_SCHEMA;
  readonly revision: number;
  readonly status: "staged_unadmitted";
  readonly preparedAt: string;
  readonly overlay: AllowlistPolicyOverlay;
  readonly registry: AssetPolicyRegistry;
  readonly recordDigest: string;
}

export interface PrepareAllowlistPolicyInput extends AllowlistPolicyOverlayInput {
  readonly expectedRevision?: number;
  readonly now: Date;
}

/** Storage identity shared by every overlay and activation schema for one policy profile. */
export function allowlistProfileHash(profile: string): string {
  if (typeof profile !== "string" || !PROFILE.test(profile)) invalid("Allowlist policy profile is invalid.", "invalid_profile");
  return domainHash(ALLOWLIST_POLICY_OVERLAY_SCHEMA, `profile\0${profile}`);
}

export function compileAllowlistPolicyOverlay(
  raw: AllowlistPolicyOverlayInput,
  inventory: AllowlistInventory = loadAllowlistInventory(),
): { readonly overlay: AllowlistPolicyOverlay; readonly registry: AssetPolicyRegistry } {
  const value = overlayInput(raw, inventory);
  const profileHash = allowlistProfileHash(value.profile);
  const body = { schemaVersion: ALLOWLIST_POLICY_OVERLAY_SCHEMA, ...value, profileHash } as const;
  const overlay: AllowlistPolicyOverlay = {
    ...body,
    overlayDigest: domainHash(ALLOWLIST_POLICY_OVERLAY_SCHEMA, canonicalJson(body)),
  };
  const chains = new Map<string, UnsignedAssetPolicyRegistry["chains"][number]>();
  for (const admission of overlay.admissions) {
    const asset = resolveAllowlistAsset(admission, inventory);
    const rails = { direct: admission.rail === "direct", gasless: admission.rail === "gasless",
      x402: admission.rail === "x402", bridge: admission.rail === "bridge", swap: admission.rail === "swap" } satisfies AssetRailAdmission;
    const row = {
      kind: asset.kind,
      identifier: asset.identifier,
      symbol: asset.symbol,
      decimals: asset.decimals,
      rails,
      caps: {
        maximumPerTransferAtomic: admission.maximumPerTransferAtomic ?? maximumMechanismCap(admission.mechanisms!),
        dailyLimitAtomic: admission.dailyLimitAtomic,
      },
      ...(admission.mechanism === undefined ? {} : { mechanismPins: { [admission.rail]: admission.mechanism } }),
      ...(admission.mechanisms === undefined ? {} : { mechanismOptions: { bridge: admission.mechanisms } }),
    } as const;
    const current = chains.get(asset.chain);
    if (current === undefined) {
      chains.set(asset.chain, { chain: asset.chain, family: asset.family, name: asset.networkName, assets: [row] });
    } else {
      chains.set(asset.chain, { ...current, assets: [...current.assets, row] });
    }
  }
  const unsigned: UnsignedAssetPolicyRegistry = {
    schemaVersion: "apn.asset-policy-registry.v1",
    registryVersion: overlay.overlayVersion,
    publishedAt: overlay.effectiveAt,
    effectiveDate: overlay.effectiveAt.slice(0, 10),
    effectiveAt: overlay.effectiveAt,
    ...(overlay.expiresAt === undefined ? {} : { expiresAt: overlay.expiresAt }),
    chains: [...chains.values()].sort((left, right) => left.chain.localeCompare(right.chain)).map((chain) => ({
      ...chain,
      assets: [...chain.assets].sort((left, right) => `${left.kind}:${left.identifier ?? ""}`.localeCompare(`${right.kind}:${right.identifier ?? ""}`)),
    })),
  };
  return { overlay, registry: sealAssetPolicyRegistry(unsigned) };
}

export function validateAllowlistPolicyRecord(value: unknown): AllowlistPolicyRecord {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "schemaVersion", "revision", "status", "preparedAt", "overlay", "registry", "recordDigest",
  ]) || value.schemaVersion !== ALLOWLIST_POLICY_RECORD_SCHEMA || value.status !== "staged_unadmitted" ||
      typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      typeof value.preparedAt !== "string" || !isoInstant(value.preparedAt) || typeof value.recordDigest !== "string" ||
      !DIGEST.test(value.recordDigest)) corrupt("Allowlist policy record schema is invalid.");
  const { recordDigest, ...body } = value;
  if (domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA, canonicalJson(body)) !== recordDigest) {
    corrupt("Allowlist policy record integrity validation failed.");
  }
  const compiled = compileAllowlistPolicyOverlay(overlayBody(value.overlay));
  if (canonicalJson(compiled.overlay) !== canonicalJson(value.overlay) ||
      canonicalJson(compiled.registry) !== canonicalJson(value.registry)) {
    corrupt("Allowlist policy record does not match its frozen inventory compilation.");
  }
  return value as unknown as AllowlistPolicyRecord;
}

function overlayInput(value: AllowlistPolicyOverlayInput, inventory: AllowlistInventory): AllowlistPolicyOverlayInput {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "overlayVersion", "profile", "account", "datasetVersion", "datasetSha256", "inventorySha256", "effectiveAt",
    ...(value.expiresAt === undefined ? [] : ["expiresAt"]), "admissions",
  ]) || typeof value.overlayVersion !== "string" || !VERSION.test(value.overlayVersion) ||
      typeof value.profile !== "string" || !PROFILE.test(value.profile) || typeof value.account !== "string" ||
      value.datasetVersion !== inventory.dataset.version || value.datasetSha256 !== inventory.dataset.sha256 ||
      value.inventorySha256 !== inventory.inventorySha256 || typeof value.effectiveAt !== "string" || !isoInstant(value.effectiveAt) ||
      (value.expiresAt !== undefined && (typeof value.expiresAt !== "string" || !isoInstant(value.expiresAt) || value.expiresAt <= value.effectiveAt)) ||
      !Array.isArray(value.admissions) || value.admissions.length === 0 || value.admissions.length > 256) {
    invalid("Allowlist policy overlay metadata is invalid.", "invalid_overlay");
  }
  const admissions = value.admissions.map(validateAllowlistAdmission);
  const identities = new Set<string>();
  let family: string | undefined;
  for (const row of admissions) {
    const asset = resolveAllowlistAsset(row, inventory);
    if (family === undefined) family = asset.family;
    if (asset.family !== family) invalid("One overlay cannot widen across account families.", "family_widening");
    const identity = `${asset.chain}\0${asset.kind}\0${asset.identifier ?? ""}\0${row.rail}`;
    if (identities.has(identity)) invalid("Allowlist policy contains a duplicate admission row.", "duplicate_admission");
    identities.add(identity);
  }
  canonicalAllowlistAccount(family!, value.account);
  return { ...value, admissions };
}

/** One owner-supplied admission row: exact identity, one rail, positive owner caps and the rail's pinned mechanism. */
export function validateAllowlistAdmission(value: unknown): AllowlistPolicyAdmissionInput {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "chain", "kind", ...(value.identifier === undefined ? [] : ["identifier"]), "rail",
    ...(value.maximumPerTransferAtomic === undefined ? [] : ["maximumPerTransferAtomic"]),
    "dailyLimitAtomic", ...(value.mechanism === undefined ? [] : ["mechanism"]),
    ...(value.mechanisms === undefined ? [] : ["mechanisms"]),
  ]) || typeof value.chain !== "string" || (value.kind !== "native" && value.kind !== "token") ||
      (value.identifier !== undefined && typeof value.identifier !== "string") ||
      (value.rail !== "direct" && value.rail !== "gasless" && value.rail !== "x402" && value.rail !== "bridge" && value.rail !== "swap")) {
    invalid("Allowlist admission row is invalid.", "invalid_admission");
  }
  const alternatives = value.mechanisms;
  if (alternatives !== undefined && (value.rail !== "bridge" || value.mechanism !== undefined ||
      value.maximumPerTransferAtomic !== undefined || !Array.isArray(alternatives) || alternatives.length < 2 || alternatives.length > 16)) {
    invalid("Bridge alternatives require two to sixteen exact pins and no legacy cap or pin.", "invalid_mechanisms");
  }
  const mechanisms = alternatives === undefined ? undefined : alternatives.map((item: unknown) => {
    if (!isPlainRecord(item) || !exactKeys(item, ["provider", "reference", "maximumPerTransferAtomic"]))
      invalid("Bridge mechanism alternative is invalid.", "invalid_mechanisms");
    const pin = mechanismPin({ provider: item.provider, reference: item.reference })!;
    return { ...pin, maximumPerTransferAtomic: positiveAtomic(item.maximumPerTransferAtomic, "maximum_per_transfer") };
  });
  if (mechanisms !== undefined && new Set(mechanisms.map((item) => `${item.provider}\0${item.reference}`)).size !== mechanisms.length)
    invalid("Bridge mechanism alternatives contain a duplicate pin.", "duplicate_mechanism");
  const maximum = mechanisms === undefined ? positiveAtomic(value.maximumPerTransferAtomic, "maximum_per_transfer") : maximumMechanismCap(mechanisms);
  const daily = positiveAtomic(value.dailyLimitAtomic, "daily_limit");
  if (BigInt(maximum) > BigInt(daily)) invalid("Per-transfer cap cannot exceed daily cap.", "cap_order");
  const mechanism = value.rail === "swap" ? swapMechanismPin(value.mechanism) : mechanismPin(value.mechanism);
  if (value.rail !== "direct" && mechanism === undefined && mechanisms === undefined) {
    invalid("The selected rail requires a nonempty pinned provider mechanism.", "mechanism_required");
  }
  if (value.rail === "direct" && mechanism !== undefined) {
    invalid("Direct admission does not accept provider mechanism metadata.", "mechanism_not_applicable");
  }
  return { chain: value.chain, kind: value.kind, ...(value.identifier === undefined ? {} : { identifier: value.identifier }),
    rail: value.rail, ...(mechanisms === undefined ? { maximumPerTransferAtomic: maximum } : {}), dailyLimitAtomic: daily,
    ...(mechanism === undefined ? {} : { mechanism }), ...(mechanisms === undefined ? {} : { mechanisms }) };
}

function maximumMechanismCap(value: readonly { readonly maximumPerTransferAtomic: string }[]): string {
  return value.reduce((max, item) => BigInt(item.maximumPerTransferAtomic) > BigInt(max) ? item.maximumPerTransferAtomic : max, "0");
}

function mechanismPin(value: unknown): AllowlistMechanismPin | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value) || !exactKeys(value, ["provider", "reference"]) || typeof value.provider !== "string" ||
      typeof value.reference !== "string" || !PIN.test(value.provider) || !PIN.test(value.reference)) {
    invalid("Pinned mechanism metadata is invalid.", "invalid_mechanism");
  }
  return value as unknown as AllowlistMechanismPin;
}

function swapMechanismPin(value: unknown): SwapMechanismPin | undefined {
  if (value === undefined) return undefined;
  try { return validateSwapMechanismPin(value); }
  catch { return invalid("Pinned swap mechanism metadata is invalid.", "invalid_swap_mechanism"); }
}

function overlayBody(value: unknown): AllowlistPolicyOverlayInput {
  if (!isPlainRecord(value) || value.schemaVersion !== ALLOWLIST_POLICY_OVERLAY_SCHEMA || typeof value.overlayDigest !== "string" ||
      typeof value.profileHash !== "string") corrupt("Allowlist policy overlay schema is invalid.");
  const { schemaVersion: _schema, profileHash: _profileHash, overlayDigest: _digest, ...body } = value;
  return body as unknown as AllowlistPolicyOverlayInput;
}

function positiveAtomic(value: unknown, field: string): string {
  try {
    if (typeof value !== "string" || value.length > 78) throw new Error("bounded");
    const parsed = parseAtomic(value, { positive: true });
    if (parsed > MAX_UINT256) throw new Error("uint256");
    return parsed.toString();
  } catch { return invalid("Atomic caps must be positive canonical uint256 values.", field); }
}

export function canonicalAllowlistAccount(family: string, value: unknown): string {
  try {
    if (typeof value !== "string") throw new Error("account");
    if (family === "evm") {
      const result = getAddress(value);
      if (result !== value || result === "0x0000000000000000000000000000000000000000") throw new Error("account");
      return result;
    }
    if (family === "solana") return solanaAddress(value);
    const result = tronAddress(value); if (result !== value) throw new Error("account"); return result;
  } catch { return invalid("Owner account is not canonical for the selected family.", "account_mismatch"); }
}

export function isoInstant(value: string): boolean {
  const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function invalid(message: string, reason: string): never {
  throw new ApnError("APN_INVALID_INPUT", message, { reason });
}
function corrupt(message: string): never { return stateCorrupt(message); }
