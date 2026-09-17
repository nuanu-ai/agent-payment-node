import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { tronAddress } from "./tron/codec.js";

export const ASSET_POLICY_REGISTRY_SCHEMA = "apn.asset-policy-registry.v1" as const;
const POLICY_DIGEST_DOMAIN = ASSET_POLICY_REGISTRY_SCHEMA;
const MAX_CHAINS = 64;
const MAX_ASSETS_PER_CHAIN = 256;
const MAX_UINT256 = (1n << 256n) - 1n;

export type AssetPolicyChainFamily = "evm" | "solana" | "tron";
export type AssetPolicyRail = "direct" | "gasless" | "x402" | "bridge" | "swap";

export interface AssetRailAdmission {
  readonly direct: boolean;
  readonly gasless: boolean;
  readonly x402: boolean;
  readonly bridge: boolean;
  readonly swap: boolean;
}

export interface AssetAtomicCaps {
  readonly maximumPerTransferAtomic: string;
  readonly dailyLimitAtomic: string;
}

export interface AssetPolicyRow {
  readonly kind: "native" | "token";
  /** Null is the only native identity. Token identities are canonical contract or mint addresses. */
  readonly identifier: string | null;
  readonly symbol: string;
  readonly decimals: number;
  readonly rails: AssetRailAdmission;
  readonly caps: AssetAtomicCaps;
}

export interface AssetPolicyChain {
  /** Exact network identity: eip155 chain ID, Solana genesis hash, or TRON genesis block ID. */
  readonly chain: string;
  readonly family: AssetPolicyChainFamily;
  readonly name: string;
  readonly assets: readonly AssetPolicyRow[];
}

export interface AssetPolicyRegistry {
  readonly schemaVersion: typeof ASSET_POLICY_REGISTRY_SCHEMA;
  readonly registryVersion: string;
  readonly publishedAt: string;
  readonly effectiveDate: string;
  readonly chains: readonly AssetPolicyChain[];
  readonly policyDigest: string;
}

export type UnsignedAssetPolicyRegistry = Omit<AssetPolicyRegistry, "policyDigest">;

export interface AssetPolicyEvaluationInput {
  readonly chain: string;
  readonly asset: Readonly<{ kind: "native"; identifier: null } | { kind: "token"; identifier: string }>;
  readonly rail: AssetPolicyRail;
  readonly amountAtomic: string;
  /** Already charged or reserved for this asset in the applicable UTC owner day. */
  readonly dailyUsageAtomic: string;
  /** Explicit UTC policy date keeps evaluation deterministic and testable. */
  readonly asOfDate: string;
}

export interface AssetPolicyAdmission {
  readonly admitted: true;
  readonly policyDigest: string;
  readonly registryVersion: string;
  readonly effectiveDate: string;
  readonly chain: string;
  readonly family: AssetPolicyChainFamily;
  readonly asset: AssetPolicyRow;
  readonly rail: AssetPolicyRail;
  readonly amountAtomic: string;
  readonly dailyUsageAtomic: string;
  readonly dailyRemainingAtomic: string;
}

export function assetPolicyDigest(value: UnsignedAssetPolicyRegistry): string {
  validateRegistryBody(value);
  return domainHash(POLICY_DIGEST_DOMAIN, canonicalJson(value));
}

export function sealAssetPolicyRegistry(value: UnsignedAssetPolicyRegistry): AssetPolicyRegistry {
  return validateAssetPolicyRegistry({ ...value, policyDigest: assetPolicyDigest(value) });
}

export function validateAssetPolicyRegistry(value: unknown): AssetPolicyRegistry {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "schemaVersion", "registryVersion", "publishedAt", "effectiveDate", "chains", "policyDigest",
  ])) invalid("The asset policy registry schema is invalid.");
  const { policyDigest, ...body } = value;
  validateRegistryBody(body);
  if (typeof policyDigest !== "string" || !/^[a-f0-9]{64}$/u.test(policyDigest) ||
      domainHash(POLICY_DIGEST_DOMAIN, canonicalJson(body)) !== policyDigest) {
    invalid("The asset policy registry digest is invalid.");
  }
  return value as unknown as AssetPolicyRegistry;
}

/** Shared fail-closed evaluator for future CLI and MCP admission surfaces. */
export function evaluateAssetPolicy(registryValue: unknown, input: AssetPolicyEvaluationInput): AssetPolicyAdmission {
  const registry = validateAssetPolicyRegistry(registryValue);
  const asOfDate = calendarDate(input.asOfDate, "Policy evaluation date");
  if (asOfDate < registry.effectiveDate) denied("The asset policy registry is not effective on the requested date.");
  const rail = policyRail(input.rail);
  const chain = registry.chains.find((row) => row.chain === input.chain);
  if (chain === undefined) denied("The network is not listed in the asset policy registry.");
  // Validation is intentionally performed against the selected chain family before lookup, so aliases,
  // sentinels and non-canonical spellings can never select a token row.
  const identifier = input.asset.kind === "native" ? null : canonicalTokenIdentifier(chain.family, input.asset.identifier);
  const asset = chain.assets.find((row) => row.kind === input.asset.kind && row.identifier === identifier);
  if (asset === undefined) denied("The asset is not listed for this network.");
  if (!asset.rails[rail]) denied("The selected rail is not admitted for this network and asset.");
  const amount = atomic(input.amountAtomic, true, "Transfer amount");
  const usage = atomic(input.dailyUsageAtomic, false, "Daily usage");
  const perTransfer = BigInt(asset.caps.maximumPerTransferAtomic);
  const dailyLimit = BigInt(asset.caps.dailyLimitAtomic);
  if (amount > perTransfer) denied("The transfer exceeds the asset policy per-transfer cap.");
  if (usage > dailyLimit || usage + amount > dailyLimit) denied("The transfer exceeds the asset policy daily cap.");
  return {
    admitted: true,
    policyDigest: registry.policyDigest,
    registryVersion: registry.registryVersion,
    effectiveDate: registry.effectiveDate,
    chain: chain.chain,
    family: chain.family,
    asset,
    rail,
    amountAtomic: amount.toString(),
    dailyUsageAtomic: usage.toString(),
    dailyRemainingAtomic: (dailyLimit - usage - amount).toString(),
  };
}

function validateRegistryBody(value: unknown): asserts value is UnsignedAssetPolicyRegistry {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "registryVersion", "publishedAt", "effectiveDate", "chains"]) ||
      value.schemaVersion !== ASSET_POLICY_REGISTRY_SCHEMA ||
      typeof value.registryVersion !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.registryVersion) ||
      typeof value.publishedAt !== "string" || !isIsoInstant(value.publishedAt)) {
    invalid("The asset policy registry metadata is invalid.");
  }
  calendarDate(value.effectiveDate, "Registry effective date");
  if (!Array.isArray(value.chains) || value.chains.length === 0 || value.chains.length > MAX_CHAINS) {
    invalid("The asset policy registry must contain a bounded, non-empty chain list.");
  }
  const identities = new Set<string>();
  for (const chain of value.chains) {
    validateChain(chain);
    if (identities.has(chain.chain)) invalid("The asset policy registry contains a duplicate chain identity.");
    identities.add(chain.chain);
  }
}

function validateChain(value: unknown): asserts value is AssetPolicyChain {
  if (!isPlainRecord(value) || !exactKeys(value, ["chain", "family", "name", "assets"]) ||
      (value.family !== "evm" && value.family !== "solana" && value.family !== "tron") ||
      typeof value.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 .()/-]{0,63}$/u.test(value.name) ||
      !canonicalChain(value.family, value.chain) || !Array.isArray(value.assets) || value.assets.length === 0 ||
      value.assets.length > MAX_ASSETS_PER_CHAIN) {
    invalid("An asset policy chain row is invalid.");
  }
  const identities = new Set<string>();
  let nativeCount = 0;
  for (const asset of value.assets) {
    validateAsset(value.family, asset);
    const identity = asset.kind === "native" ? "native" : `token:${asset.identifier}`;
    if (identities.has(identity)) invalid("An asset policy chain contains a duplicate asset identity.");
    identities.add(identity);
    if (asset.kind === "native") nativeCount += 1;
  }
  if (nativeCount !== 1) invalid("Each asset policy chain must contain exactly one native asset row.");
}

function validateAsset(family: AssetPolicyChainFamily, value: unknown): asserts value is AssetPolicyRow {
  if (!isPlainRecord(value) || !exactKeys(value, ["kind", "identifier", "symbol", "decimals", "rails", "caps"]) ||
      (value.kind !== "native" && value.kind !== "token") ||
      typeof value.symbol !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,15}$/u.test(value.symbol) ||
      typeof value.decimals !== "number" || !Number.isSafeInteger(value.decimals) || value.decimals < 0 || value.decimals > 255) {
    invalid("An asset policy asset row is invalid.");
  }
  if (value.kind === "native") {
    if (value.identifier !== null) invalid("A native asset must use the null identity.");
  } else if (typeof value.identifier !== "string" || canonicalTokenIdentifier(family, value.identifier) !== value.identifier) {
    invalid("A token must use its canonical contract or mint address.");
  }
  validateRails(value.rails);
  validateCaps(value.caps);
}

function validateRails(value: unknown): asserts value is AssetRailAdmission {
  if (!isPlainRecord(value) || !exactKeys(value, ["direct", "gasless", "x402", "bridge", "swap"]) ||
      Object.values(value).some((admitted) => typeof admitted !== "boolean")) {
    invalid("Asset rail admission flags are invalid.");
  }
}

function validateCaps(value: unknown): asserts value is AssetAtomicCaps {
  if (!isPlainRecord(value) || !exactKeys(value, ["maximumPerTransferAtomic", "dailyLimitAtomic"])) {
    invalid("Asset atomic caps are invalid.");
  }
  const maximum = atomic(value.maximumPerTransferAtomic, true, "Per-transfer cap");
  const daily = atomic(value.dailyLimitAtomic, true, "Daily cap");
  if (maximum > daily) invalid("The per-transfer cap cannot exceed the daily cap.");
}

function canonicalChain(family: AssetPolicyChainFamily, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (family === "evm") {
    const match = /^eip155:([1-9][0-9]{0,77})$/u.exec(value);
    return match !== null && BigInt(match[1]!) <= MAX_UINT256;
  }
  if (family === "solana") {
    if (!/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value)) return false;
    try { return solanaAddress(value.slice("solana:".length)) === value.slice("solana:".length); } catch { return false; }
  }
  return /^tron:[a-f0-9]{64}$/u.test(value);
}

function canonicalTokenIdentifier(family: AssetPolicyChainFamily, value: unknown): string {
  if (typeof value !== "string") invalid("Token identity must be a canonical contract or mint address.");
  try {
    if (family === "evm") {
      const canonical = getAddress(value);
      if (canonical === "0x0000000000000000000000000000000000000000" || canonical !== value) throw new Error("non-canonical");
      return canonical;
    }
    if (family === "solana") return solanaAddress(value);
    return tronAddress(value);
  } catch {
    return invalid("Token identity must be a canonical contract or mint address.");
  }
}

function policyRail(value: unknown): AssetPolicyRail {
  if (value !== "direct" && value !== "gasless" && value !== "x402" && value !== "bridge" && value !== "swap") {
    return invalid("Policy rail is invalid.");
  }
  return value;
}

function atomic(value: unknown, positive: boolean, label: string): bigint {
  try {
    if (typeof value !== "string" || value.length > 78) throw new Error("bounded uint256");
    const parsed = parseAtomic(value, { positive });
    if (parsed > MAX_UINT256) throw new Error("uint256");
    return parsed;
  } catch {
    return invalid(`${label} must be a canonical uint256 atomic amount${positive ? " greater than zero" : ""}.`);
  }
}

function calendarDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    return invalid(`${label} must be an exact UTC calendar date.`);
  }
  return value;
}

function isIsoInstant(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function denied(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
