import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { tronAddress } from "./tron/codec.js";

export const ALLOWLIST_INVENTORY_SCHEMA = "apn.allowlist-inventory.v1" as const;
export const ALLOWLIST_DATASET_SCHEMA = "apn.asset-policy-candidate-dataset.v1" as const;
export const ALLOWLIST_DATASET_VERSION = "2026-09-17.market-cap-top-10.1" as const;
export const ALLOWLIST_DATASET_SHA256 = "2af4736e081f2981d775c8cee72015152dfabe1315b035f87f506500b08625f0" as const;
export const ALLOWLIST_DATASET_PATH = "data/allowlist/2026-09-17/dataset.json" as const;

const RAILS = ["direct", "gasless", "x402", "bridge", "swap"] as const;
export type CandidateRail = typeof RAILS[number];
export type CandidateFamily = "evm" | "solana" | "tron";
export type CandidateKind = "native" | "token";
export interface CandidateRails {
  readonly direct: false; readonly gasless: false; readonly x402: false; readonly bridge: false; readonly swap: false;
}
export interface CandidateAsset {
  readonly chain: string;
  readonly family: CandidateFamily;
  readonly networkName: string;
  readonly kind: CandidateKind;
  readonly identifier: string | null;
  readonly symbol: string;
  readonly decimals: number;
  readonly selectionClass: "top_10" | "native_additional" | null;
  readonly tokenStandard: string | null;
  readonly eligibility: "issuer_native" | null;
  readonly rails: CandidateRails;
  readonly caps: null;
  readonly evidence: Readonly<Record<string, string>>;
  readonly admission: "not_admitted_owner_configuration_missing";
}
export interface CandidateNetwork {
  readonly chain: string;
  readonly family: CandidateFamily;
  readonly name: string;
  readonly assetCount: number;
  readonly deploymentCount: number;
}
export interface CandidateDeployment {
  readonly chain: string;
  readonly family: CandidateFamily;
  readonly networkName: string;
  readonly identifier: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly tokenStandard: string;
  readonly eligibility: "issuer_native";
  readonly evidence: Readonly<Record<string, string>>;
}
export interface AllowlistInventory {
  readonly schemaVersion: typeof ALLOWLIST_INVENTORY_SCHEMA;
  readonly dataset: {
    readonly schemaVersion: typeof ALLOWLIST_DATASET_SCHEMA;
    readonly version: typeof ALLOWLIST_DATASET_VERSION;
    readonly retrievedAt: string;
    readonly path: typeof ALLOWLIST_DATASET_PATH;
    readonly sha256: string;
  };
  readonly policyRegistry: {
    readonly targetSchemaVersion: "apn.asset-policy-registry.v1";
    readonly referenceCommit: string;
    readonly status: "blocked_owner_caps_missing";
    readonly configured: false;
  };
  readonly provenance: {
    readonly source: string;
    readonly requestUrl: string;
    readonly responsePath: string;
    readonly responseSha256: string;
    readonly platformMetadataRequestUrl: string;
    readonly platformMetadataResponsePath: string;
    readonly platformMetadataResponseSha256: string;
    readonly includeRehypothecated: false;
    readonly candidateCount: 10;
  };
  readonly railStates: readonly { readonly rail: CandidateRail; readonly admitted: false }[];
  readonly networks: readonly CandidateNetwork[];
  readonly assets: readonly CandidateAsset[];
  readonly deployments: readonly CandidateDeployment[];
  readonly inventorySha256: string;
}

type InventoryBody = Omit<AllowlistInventory, "inventorySha256">;
let cached: AllowlistInventory | undefined;

export function loadAllowlistInventory(): AllowlistInventory {
  if (cached !== undefined) return cached;
  cached = compileAllowlistInventory(datasetBytes());
  return cached;
}

/** Compile only the exact byte sequence bound to this release. Parsed objects are never accepted with a caller-supplied digest. */
export function compileAllowlistInventory(input: string | Buffer): AllowlistInventory {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  const digest = sha256(bytes);
  if (digest !== ALLOWLIST_DATASET_SHA256) shippedDatasetInvalid("The frozen allowlist dataset digest does not match the release constant.");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { return shippedDatasetInvalid("The frozen allowlist dataset is not valid JSON."); }
  return compileVerifiedAllowlistInventory(value, digest);
}

function compileVerifiedAllowlistInventory(value: unknown, datasetSha256: string): AllowlistInventory {
  if (!/^[a-f0-9]{64}$/u.test(datasetSha256)) shippedDatasetInvalid("The allowlist dataset digest is invalid.");
  const dataset = record(value, "The allowlist candidate dataset is invalid.");
  requireExact(dataset, ["schemaVersion", "datasetVersion", "retrievedAt", "selection", "assetPolicyRegistryCompatibility", "rankedCandidates", "chains", "explicitRefusals", "sourceNotes"]);
  if (dataset.schemaVersion !== ALLOWLIST_DATASET_SCHEMA || dataset.datasetVersion !== ALLOWLIST_DATASET_VERSION ||
      typeof dataset.retrievedAt !== "string" || !Number.isFinite(Date.parse(dataset.retrievedAt))) {
    shippedDatasetInvalid("The allowlist candidate dataset identity is invalid.");
  }
  const compatibility = record(dataset.assetPolicyRegistryCompatibility, "The allowlist registry compatibility declaration is invalid.");
  requireExact(compatibility, ["targetSchemaVersion", "referenceCommit", "status", "explanation"]);
  if (compatibility.targetSchemaVersion !== "apn.asset-policy-registry.v1" ||
      compatibility.status !== "blocked_owner_caps_missing" || typeof compatibility.referenceCommit !== "string") {
    shippedDatasetInvalid("The allowlist registry compatibility declaration is invalid.");
  }
  const selection = selectionProvenance(dataset.selection);
  if (!Array.isArray(dataset.chains) || dataset.chains.length === 0) shippedDatasetInvalid("The allowlist network inventory is empty.");
  const assets: CandidateAsset[] = [], networks: CandidateNetwork[] = [], deployments: CandidateDeployment[] = [];
  const chainIds = new Set<string>();
  for (const raw of dataset.chains) {
    const chain = record(raw, "An allowlist network row is invalid.");
    requireExact(chain, ["chain", "family", "name", "native", "verifiedTokenDeployments"]);
    const family = candidateFamily(chain.family), chainId = canonicalChain(family, chain.chain);
    if (chainIds.has(chainId) || typeof chain.name !== "string" || chain.name.length === 0 || !Array.isArray(chain.verifiedTokenDeployments)) {
      shippedDatasetInvalid("An allowlist network row is invalid.");
    }
    chainIds.add(chainId);
    const native = candidateAsset(chain.native, chainId, family, chain.name, "native");
    assets.push(native);
    for (const token of chain.verifiedTokenDeployments) {
      const asset = candidateAsset(token, chainId, family, chain.name, "token");
      if (assets.some((row) => row.chain === chainId && row.kind === "token" && row.identifier === asset.identifier)) {
        shippedDatasetInvalid("An allowlist network contains a duplicate token deployment.");
      }
      assets.push(asset);
      deployments.push({ chain: chainId, family, networkName: chain.name, identifier: asset.identifier!, symbol: asset.symbol,
        decimals: asset.decimals, tokenStandard: asset.tokenStandard!, eligibility: "issuer_native", evidence: asset.evidence });
    }
    networks.push({ chain: chainId, family, name: chain.name, assetCount: 1 + chain.verifiedTokenDeployments.length,
      deploymentCount: chain.verifiedTokenDeployments.length });
  }
  const body: InventoryBody = {
    schemaVersion: ALLOWLIST_INVENTORY_SCHEMA,
    dataset: { schemaVersion: ALLOWLIST_DATASET_SCHEMA, version: ALLOWLIST_DATASET_VERSION,
      retrievedAt: dataset.retrievedAt, path: ALLOWLIST_DATASET_PATH, sha256: datasetSha256 },
    policyRegistry: { targetSchemaVersion: "apn.asset-policy-registry.v1", referenceCommit: compatibility.referenceCommit,
      status: "blocked_owner_caps_missing", configured: false },
    provenance: selection,
    railStates: RAILS.map((rail) => ({ rail, admitted: false as const })), networks, assets, deployments,
  };
  return { ...body, inventorySha256: sha256(canonicalJson(body)) };
}

export function resolveAllowlistAsset(input: {
  readonly chain: string; readonly kind: CandidateKind; readonly identifier?: string;
}, inventory: AllowlistInventory = loadAllowlistInventory()): CandidateAsset {
  const network = inventory.networks.find((row) => row.chain === input.chain);
  if (network === undefined) refuse("APN_ALLOWLIST_UNKNOWN_CHAIN", "The exact network identity is absent from the frozen allowlist inventory.", "unknown_chain");
  if (input.kind !== "native" && input.kind !== "token") {
    refuse("APN_ALLOWLIST_IDENTITY_INVALID", "Asset kind must be exactly native or token.", "invalid_kind");
  }
  if (input.kind === "native") {
    if (input.identifier !== undefined) refuse("APN_ALLOWLIST_IDENTITY_INVALID", "Native identity requires an omitted identifier.", "native_token_confusion");
    return inventory.assets.find((row) => row.chain === input.chain && row.kind === "native")!;
  }
  if (input.identifier === undefined) refuse("APN_ALLOWLIST_IDENTITY_INVALID", "Token identity requires the exact canonical deployment identifier.", "missing_token_identifier");
  const identifier = canonicalToken(network.family, input.identifier);
  const asset = inventory.assets.find((row) => row.chain === input.chain && row.kind === "token" && row.identifier === identifier);
  if (asset === undefined) refuse("APN_ALLOWLIST_ASSET_NOT_FOUND", "The exact token deployment is absent from the frozen allowlist inventory.", "unknown_token_deployment");
  return asset;
}

export function assertAllowlistExecutionConfigured(input: {
  readonly chain: string; readonly kind: CandidateKind; readonly identifier?: string; readonly rail: CandidateRail;
}, inventory: AllowlistInventory = loadAllowlistInventory()): never {
  const asset = resolveAllowlistAsset(input, inventory);
  if (!RAILS.includes(input.rail)) refuse("APN_ALLOWLIST_IDENTITY_INVALID", "The requested rail is invalid.", "invalid_rail");
  const reason = asset.rails[input.rail] ? "owner_caps_missing" : "rail_not_admitted";
  refuse("APN_ALLOWLIST_NOT_ADMITTED", "The candidate identity is not configured for execution.", reason);
}

function candidateAsset(raw: unknown, chain: string, family: CandidateFamily, networkName: string, kind: CandidateKind): CandidateAsset {
  const value = record(raw, "An allowlist asset row is invalid.");
  const keys = kind === "native"
    ? ["kind", "identifier", "symbol", "decimals", "selectionClass", "rails", "caps", "evidence"]
    : ["kind", "identifier", "symbol", "decimals", "tokenStandard", "eligibility", "rails", "caps", "evidence"];
  requireExact(value, keys);
  if (value.kind !== kind || typeof value.symbol !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,15}$/u.test(value.symbol) ||
      typeof value.decimals !== "number" || !Number.isSafeInteger(value.decimals) || value.decimals < 0 || value.decimals > 255 || value.caps !== null) {
    shippedDatasetInvalid("An allowlist asset row is invalid.");
  }
  const rails = disabledRails(value.rails), evidence = stringRecord(value.evidence);
  if (kind === "native") {
    if (value.identifier !== null || (value.selectionClass !== "top_10" && value.selectionClass !== "native_additional")) {
      shippedDatasetInvalid("An allowlist native asset identity is invalid.");
    }
    return { chain, family, networkName, kind, identifier: null, symbol: value.symbol, decimals: value.decimals,
      selectionClass: value.selectionClass, tokenStandard: null, eligibility: null, rails, caps: null, evidence,
      admission: "not_admitted_owner_configuration_missing" };
  }
  if (value.eligibility !== "issuer_native" || typeof value.tokenStandard !== "string") shippedDatasetInvalid("An allowlist token deployment is invalid.");
  return { chain, family, networkName, kind, identifier: canonicalToken(family, value.identifier), symbol: value.symbol,
    decimals: value.decimals, selectionClass: null, tokenStandard: value.tokenStandard, eligibility: "issuer_native",
    rails, caps: null, evidence, admission: "not_admitted_owner_configuration_missing" };
}

function selectionProvenance(raw: unknown): AllowlistInventory["provenance"] {
  const value = record(raw, "The allowlist selection provenance is invalid.");
  for (const key of ["source", "requestUrl", "responsePath", "responseSha256", "platformMetadataRequestUrl",
    "platformMetadataResponsePath", "platformMetadataResponseSha256"]) if (typeof value[key] !== "string") shippedDatasetInvalid("The allowlist selection provenance is invalid.");
  if (value.includeRehypothecated !== false || value.candidateCount !== 10) shippedDatasetInvalid("The allowlist selection boundary is invalid.");
  return { source: value.source as string, requestUrl: value.requestUrl as string, responsePath: value.responsePath as string,
    responseSha256: value.responseSha256 as string, platformMetadataRequestUrl: value.platformMetadataRequestUrl as string,
    platformMetadataResponsePath: value.platformMetadataResponsePath as string,
    platformMetadataResponseSha256: value.platformMetadataResponseSha256 as string, includeRehypothecated: false, candidateCount: 10 };
}

function disabledRails(raw: unknown): CandidateRails {
  const value = record(raw, "Allowlist rail states are invalid."); requireExact(value, [...RAILS]);
  if (RAILS.some((rail) => value[rail] !== false)) shippedDatasetInvalid("The frozen allowlist must keep every execution rail disabled.");
  return value as unknown as CandidateRails;
}

function canonicalChain(family: CandidateFamily, raw: unknown): string {
  if (typeof raw !== "string") shippedDatasetInvalid("An allowlist network identity is invalid.");
  if (family === "evm" && /^eip155:[1-9][0-9]*$/u.test(raw)) return raw;
  if (family === "solana" && raw.startsWith("solana:")) {
    try { if (solanaAddress(raw.slice(7)) === raw.slice(7)) return raw; } catch { /* classified below */ }
  }
  if (family === "tron" && /^tron:[a-f0-9]{64}$/u.test(raw)) return raw;
  return shippedDatasetInvalid("An allowlist network identity is invalid.");
}

function canonicalToken(family: CandidateFamily, raw: unknown): string {
  if (typeof raw !== "string") refuse("APN_ALLOWLIST_IDENTITY_INVALID", "Token identity must be the exact canonical deployment identifier.", "invalid_token_identifier");
  try {
    const canonical = family === "evm" ? getAddress(raw) : family === "solana" ? solanaAddress(raw) : tronAddress(raw);
    if (canonical !== raw || canonical === "0x0000000000000000000000000000000000000000") throw new Error("non-canonical");
    return canonical;
  } catch { return refuse("APN_ALLOWLIST_IDENTITY_INVALID", "Token identity must be the exact canonical deployment identifier.", "invalid_token_identifier"); }
}

function candidateFamily(raw: unknown): CandidateFamily {
  if (raw === "evm" || raw === "solana" || raw === "tron") return raw;
  return shippedDatasetInvalid("An allowlist network family is invalid.");
}
function stringRecord(raw: unknown): Readonly<Record<string, string>> {
  const value = record(raw, "Allowlist evidence is invalid.");
  if (Object.values(value).some((item) => typeof item !== "string")) shippedDatasetInvalid("Allowlist evidence is invalid.");
  return value as Record<string, string>;
}
function record(raw: unknown, message: string): Record<string, unknown> {
  if (!isPlainRecord(raw)) shippedDatasetInvalid(message); return raw;
}
function requireExact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!exactKeys(value, keys)) shippedDatasetInvalid("The frozen allowlist dataset contains an unexpected schema field.");
}
function datasetBytes(): Buffer {
  const candidates = [new URL(`../${ALLOWLIST_DATASET_PATH}`, import.meta.url), new URL(`../../${ALLOWLIST_DATASET_PATH}`, import.meta.url)];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path === undefined) return shippedDatasetInvalid("The frozen allowlist dataset is missing from the installation.");
  try { return readFileSync(path); } catch { return shippedDatasetInvalid("The frozen allowlist dataset cannot be read."); }
}
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function shippedDatasetInvalid(message: string): never { throw new ApnError("APN_INTERNAL", message, { reason: "allowlist_dataset_invalid" }); }
function refuse(code: "APN_ALLOWLIST_UNKNOWN_CHAIN" | "APN_ALLOWLIST_IDENTITY_INVALID" | "APN_ALLOWLIST_ASSET_NOT_FOUND" | "APN_ALLOWLIST_NOT_ADMITTED", message: string, reason: string): never {
  throw new ApnError(code, message, { reason });
}
