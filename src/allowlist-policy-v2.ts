import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import {
  type AllowlistInventory,
  type CandidateAsset,
  type CandidateFamily,
  type CandidateRail,
  loadAllowlistInventory,
  resolveAllowlistAsset,
} from "./allowlist-inventory.js";
import {
  allowlistProfileHash,
  canonicalAllowlistAccount,
  isoInstant,
  validateAllowlistAdmission,
  type AllowlistAdmissionMechanismPin,
  type AllowlistPolicyAdmissionInput,
} from "./allowlist-policy-overlay.js";
import {
  ASSET_POLICY_REGISTRY_SCHEMA_V2,
  sealAssetPolicyRegistry,
  type AssetAtomicCaps,
  type AssetPolicyChain,
  type AssetPolicyRegistry,
  type AssetPolicyRow,
  type AssetRailAdmission,
} from "./asset-policy-registry.js";
import { stateCorrupt } from "./secure-state-store.js";

export const ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2 = "apn.allowlist-policy-overlay.v2" as const;
export const ALLOWLIST_POLICY_RECORD_SCHEMA_V2 = "apn.allowlist-policy-record.v2" as const;
/** The owner-written file format accepted by `apn allowlist policy stage --file`. */
export const ALLOWLIST_POLICY_FILE_SCHEMA = "apn.allowlist-policy-file.v1" as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const FAMILIES = ["evm", "solana", "tron"] as const;
const MAX_ADMISSIONS = 256;

/** One canonical owner account per admitted family. */
export type AllowlistPolicyAccounts = Readonly<Partial<Record<CandidateFamily, string>>>;

export interface AllowlistPolicyFile {
  readonly schemaVersion: typeof ALLOWLIST_POLICY_FILE_SCHEMA;
  readonly overlayVersion: string;
  readonly accounts: AllowlistPolicyAccounts;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
  readonly admissions: readonly AllowlistPolicyAdmissionInput[];
}

export interface AllowlistPolicyOverlayV2Input {
  readonly overlayVersion: string;
  readonly profile: string;
  readonly accounts: AllowlistPolicyAccounts;
  readonly datasetVersion: string;
  readonly datasetSha256: string;
  readonly inventorySha256: string;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
  readonly admissions: readonly AllowlistPolicyAdmissionInput[];
}

export interface AllowlistPolicyOverlayV2 extends AllowlistPolicyOverlayV2Input {
  readonly schemaVersion: typeof ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2;
  readonly profileHash: string;
  readonly overlayDigest: string;
}

export interface AllowlistPolicyRecordV2 {
  readonly schemaVersion: typeof ALLOWLIST_POLICY_RECORD_SCHEMA_V2;
  readonly revision: number;
  readonly status: "staged_unadmitted";
  readonly preparedAt: string;
  readonly overlay: AllowlistPolicyOverlayV2;
  readonly registry: AssetPolicyRegistry;
  readonly recordDigest: string;
}

interface MergedRow {
  readonly asset: CandidateAsset;
  readonly rails: Record<CandidateRail, boolean>;
  readonly railCaps: Partial<Record<CandidateRail, AssetAtomicCaps>>;
  readonly pins: Partial<Record<CandidateRail, AllowlistAdmissionMechanismPin>>;
}

/**
 * Compile many owner admissions (assets x rails, across EVM, TRON and Solana) into one sealed per-rail-cap registry.
 * Admissions of one asset on several rails merge into one registry row; every cap is copied from the owner input.
 */
export function compileAllowlistPolicyOverlayV2(
  raw: AllowlistPolicyOverlayV2Input,
  inventory: AllowlistInventory = loadAllowlistInventory(),
): { readonly overlay: AllowlistPolicyOverlayV2; readonly registry: AssetPolicyRegistry } {
  const value = overlayInput(raw, inventory);
  const body = { schemaVersion: ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2, ...value, profileHash: allowlistProfileHash(value.profile) } as const;
  const overlay: AllowlistPolicyOverlayV2 = { ...body, overlayDigest: domainHash(ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2, canonicalJson(body)) };
  const merged = new Map<string, MergedRow>();
  for (const admission of overlay.admissions) {
    const asset = resolveAllowlistAsset(admission, inventory);
    const key = `${asset.chain}\0${asset.kind}\0${asset.identifier ?? ""}`;
    const row = merged.get(key) ?? { asset, rails: { direct: false, gasless: false, x402: false, bridge: false, swap: false },
      railCaps: {}, pins: {} };
    row.rails[admission.rail] = true;
    row.railCaps[admission.rail] = { maximumPerTransferAtomic: admission.maximumPerTransferAtomic, dailyLimitAtomic: admission.dailyLimitAtomic };
    if (admission.mechanism !== undefined) row.pins[admission.rail] = admission.mechanism;
    merged.set(key, row);
  }
  const chains = new Map<string, AssetPolicyChain>();
  for (const row of merged.values()) {
    const asset: AssetPolicyRow = {
      kind: row.asset.kind, identifier: row.asset.identifier, symbol: row.asset.symbol, decimals: row.asset.decimals,
      rails: row.rails as AssetRailAdmission, railCaps: row.railCaps,
      ...(Object.keys(row.pins).length === 0 ? {} : { mechanismPins: row.pins as NonNullable<AssetPolicyRow["mechanismPins"]> }),
    };
    const current = chains.get(row.asset.chain);
    chains.set(row.asset.chain, current === undefined
      ? { chain: row.asset.chain, family: row.asset.family, name: row.asset.networkName, assets: [asset] }
      : { ...current, assets: [...current.assets, asset] });
  }
  return { overlay, registry: sealAssetPolicyRegistry({
    schemaVersion: ASSET_POLICY_REGISTRY_SCHEMA_V2,
    registryVersion: overlay.overlayVersion,
    publishedAt: overlay.effectiveAt,
    effectiveDate: overlay.effectiveAt.slice(0, 10),
    effectiveAt: overlay.effectiveAt,
    ...(overlay.expiresAt === undefined ? {} : { expiresAt: overlay.expiresAt }),
    // Code-unit order, never locale collation: the sealed bytes must recompile identically under any locale.
    chains: [...chains.values()].sort((left, right) => codeUnitOrder(left.chain, right.chain)).map((chain) => ({
      ...chain,
      assets: [...chain.assets].sort((left, right) => codeUnitOrder(`${left.kind}:${left.identifier ?? ""}`, `${right.kind}:${right.identifier ?? ""}`)),
    })),
  }) };
}

/** Parse the owner-written policy file. Every cap, account, instant and pin must be present; nothing is filled in. */
export function parseAllowlistPolicyFile(value: unknown): AllowlistPolicyFile {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "overlayVersion", "accounts", "effectiveAt",
    ...(value.expiresAt === undefined ? [] : ["expiresAt"]), "admissions"]) || value.schemaVersion !== ALLOWLIST_POLICY_FILE_SCHEMA) {
    invalid(`The policy file must be one ${ALLOWLIST_POLICY_FILE_SCHEMA} object with exactly overlayVersion, accounts, effectiveAt, optional expiresAt and admissions.`,
      "invalid_policy_file");
  }
  return value as unknown as AllowlistPolicyFile;
}

export function validateAllowlistPolicyRecordV2(value: unknown): AllowlistPolicyRecordV2 {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "schemaVersion", "revision", "status", "preparedAt", "overlay", "registry", "recordDigest",
  ]) || value.schemaVersion !== ALLOWLIST_POLICY_RECORD_SCHEMA_V2 || value.status !== "staged_unadmitted" ||
      typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      typeof value.preparedAt !== "string" || !isoInstant(value.preparedAt) || typeof value.recordDigest !== "string" ||
      !DIGEST.test(value.recordDigest)) corrupt("Allowlist policy record schema is invalid.");
  const { recordDigest, ...body } = value;
  if (domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA_V2, canonicalJson(body)) !== recordDigest) {
    corrupt("Allowlist policy record integrity validation failed.");
  }
  const overlay = value.overlay;
  if (!isPlainRecord(overlay) || overlay.schemaVersion !== ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2) corrupt("Allowlist policy overlay schema is invalid.");
  const { schemaVersion: _schema, profileHash: _profileHash, overlayDigest: _digest, ...input } = overlay;
  let compiled: ReturnType<typeof compileAllowlistPolicyOverlayV2>;
  try { compiled = compileAllowlistPolicyOverlayV2(input as unknown as AllowlistPolicyOverlayV2Input); }
  catch { return corrupt("Allowlist policy record no longer compiles against the frozen inventory."); }
  if (canonicalJson(compiled.overlay) !== canonicalJson(overlay) || canonicalJson(compiled.registry) !== canonicalJson(value.registry)) {
    corrupt("Allowlist policy record does not match its frozen inventory compilation.");
  }
  return value as unknown as AllowlistPolicyRecordV2;
}

export function sealAllowlistPolicyRecordV2(body: Omit<AllowlistPolicyRecordV2, "recordDigest">): AllowlistPolicyRecordV2 {
  return validateAllowlistPolicyRecordV2({ ...body, recordDigest: domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA_V2, canonicalJson(body)) });
}

function overlayInput(value: AllowlistPolicyOverlayV2Input, inventory: AllowlistInventory): AllowlistPolicyOverlayV2Input {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "overlayVersion", "profile", "accounts", "datasetVersion", "datasetSha256", "inventorySha256", "effectiveAt",
    ...(value.expiresAt === undefined ? [] : ["expiresAt"]), "admissions",
  ]) || typeof value.overlayVersion !== "string" || !VERSION.test(value.overlayVersion) || typeof value.profile !== "string" ||
      value.datasetVersion !== inventory.dataset.version || value.datasetSha256 !== inventory.dataset.sha256 ||
      value.inventorySha256 !== inventory.inventorySha256 || typeof value.effectiveAt !== "string" || !isoInstant(value.effectiveAt) ||
      (value.expiresAt !== undefined && (typeof value.expiresAt !== "string" || !isoInstant(value.expiresAt) || value.expiresAt <= value.effectiveAt)) ||
      !Array.isArray(value.admissions) || value.admissions.length === 0 || value.admissions.length > MAX_ADMISSIONS) {
    invalid("Allowlist policy overlay metadata is invalid.", "invalid_overlay");
  }
  allowlistProfileHash(value.profile);
  const admissions = value.admissions.map(validateAllowlistAdmission);
  const identities = new Set<string>();
  const families = new Set<CandidateFamily>();
  for (const row of admissions) {
    const asset = resolveAllowlistAsset(row, inventory);
    families.add(asset.family);
    const identity = `${asset.chain}\0${asset.kind}\0${asset.identifier ?? ""}\0${row.rail}`;
    if (identities.has(identity)) invalid("Allowlist policy contains a duplicate admission row.", "duplicate_admission");
    identities.add(identity);
    if (row.rail === "swap" && (row.mechanism === undefined || !("chain" in row.mechanism) || row.mechanism.chain !== asset.chain)) {
      invalid("A swap admission must pin a swap mechanism for its exact network.", "swap_mechanism_chain_mismatch");
    }
  }
  const accounts = value.accounts;
  const used = FAMILIES.filter((family) => families.has(family));
  if (!isPlainRecord(accounts) || !exactKeys(accounts, used)) {
    invalid("Owner accounts must name exactly one account for each admitted family.", "account_families_mismatch");
  }
  for (const family of used) canonicalAllowlistAccount(family, accounts[family]);
  return { ...value, accounts: Object.fromEntries(used.map((family) => [family, accounts[family]])), admissions };
}

function codeUnitOrder(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function invalid(message: string, reason: string): never {
  throw new ApnError("APN_INVALID_INPUT", message, { reason });
}
function corrupt(message: string): never { return stateCorrupt(message); }
