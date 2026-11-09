import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ChainAccountStore } from "./chain-account-store.js";
import { ApnError } from "./errors.js";
import { loadAllowlistInventory } from "./allowlist-inventory.js";
import { policyChainFamily } from "./allowlist-recipient-pins.js";
import {
  ALLOWLIST_POLICY_RECORD_SCHEMA_V2,
  compileAllowlistPolicyOverlayV2,
  sealAllowlistPolicyRecordV2,
  type AllowlistPolicyAccounts,
  type AllowlistPolicyRecordV2,
} from "./allowlist-policy-v2.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import { StateStore } from "./state.js";

/** The variable naming the one owner policy that every profile of a server shares. There is no default path. */
export const GLOBAL_POLICY_FILE_ENV = "APN_GLOBAL_POLICY_FILE";
export const GLOBAL_POLICY_FILE_SCHEMA = "apn.global-allowlist-policy.v1" as const;
const MAX_FILE_BYTES = 1024 * 1024;
const FAMILIES = ["evm", "solana", "tron"] as const;

/**
 * The global policy file: an ordinary owner allowlist file without `accounts`. Each profile is bound to its own
 * public addresses when the policy is read, so one file configured once admits the same assets, rails, mechanisms,
 * caps and recipient pins for every profile, each profile keeping its own daily caps.
 */
export interface GlobalAllowlistPolicyFile {
  readonly schemaVersion: typeof GLOBAL_POLICY_FILE_SCHEMA;
  readonly overlayVersion: string;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
  readonly admissions: readonly Readonly<Record<string, unknown>>[];
  /** Local x402 wallet policies (`wallet policy set`), one row per x402 network and asset. */
  readonly walletPolicies?: readonly Readonly<Record<string, unknown>>[];
  /** Solana and TRON direct-rail admissions (`chain policy admit`), one row per rail and asset alias. */
  readonly chainPolicies?: readonly Readonly<Record<string, unknown>>[];
}

/** The parsed global policy document; read on every policy read so an operator edit takes effect at once. */
export async function readGlobalPolicyDocument(path: string): Promise<GlobalAllowlistPolicyFile> {
  return parseGlobalPolicyFile(await readPolicyFile(path));
}

export function globalPolicyPath(): string | null {
  const value = process.env[GLOBAL_POLICY_FILE_ENV];
  if (value === undefined || value === "") return null;
  if (!value.startsWith("/")) throw new ApnError("APN_INVALID_INPUT", `${GLOBAL_POLICY_FILE_ENV} must be an absolute path.`);
  return value;
}

/** Refuses per-profile staging and activation while the server's global policy is in force. */
export function assertNoGlobalPolicy(): void {
  if (globalPolicyPath() !== null) {
    throw new ApnError("APN_INVALID_INPUT", `Profile allowlists are managed by ${GLOBAL_POLICY_FILE_ENV} on this server.`, {
      reason: "global_policy_in_force",
    });
  }
}

export interface GlobalPolicyBinding {
  readonly record: AllowlistPolicyRecordV2;
  /** Stable for one file and one profile, so digests frozen at prepare match at approve. */
  readonly approvalFingerprint: string;
  readonly decidedAt: string;
}

/** The global policy compiled for one profile, or null when the profile holds no account the policy admits. */
export async function bindGlobalPolicy(root: string, path: string, profile: string): Promise<GlobalPolicyBinding | null> {
  const file = await readGlobalPolicyDocument(path);
  if (file.admissions.length === 0) return null;
  const owned = await profileAccounts(root, profile);
  const admissions = file.admissions.filter((row) => {
    const family = policyChainFamily(row.chain);
    return family !== null && owned[family] !== undefined;
  });
  if (admissions.length === 0) return null;
  const used = new Set(admissions.map((row) => policyChainFamily(row.chain)!));
  const accounts: AllowlistPolicyAccounts = Object.fromEntries(FAMILIES.filter((family) => used.has(family)).map((family) => [family, owned[family]]));
  const inventory = loadAllowlistInventory();
  const compiled = compileAllowlistPolicyOverlayV2({
    overlayVersion: file.overlayVersion, profile, accounts, effectiveAt: file.effectiveAt,
    ...(file.expiresAt === undefined ? {} : { expiresAt: file.expiresAt }), admissions,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
  } as unknown as Parameters<typeof compileAllowlistPolicyOverlayV2>[0], inventory);
  const record = sealAllowlistPolicyRecordV2({ schemaVersion: ALLOWLIST_POLICY_RECORD_SCHEMA_V2, revision: 1,
    status: "staged_unadmitted", preparedAt: file.effectiveAt, overlay: compiled.overlay, registry: compiled.registry });
  return {
    record,
    approvalFingerprint: domainHash(GLOBAL_POLICY_FILE_SCHEMA, canonicalJson({ overlayVersion: file.overlayVersion, effectiveAt: file.effectiveAt,
      expiresAt: file.expiresAt ?? null, admissions, profile, accounts })),
    decidedAt: file.effectiveAt,
  };
}

function parseGlobalPolicyFile(value: unknown): GlobalAllowlistPolicyFile {
  const rows = (field: unknown): boolean => Array.isArray(field) && field.every((row) => isPlainRecord(row));
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "overlayVersion", "effectiveAt",
    ...["expiresAt", "walletPolicies", "chainPolicies"].filter((key) => value[key] !== undefined), "admissions"]) ||
      value.schemaVersion !== GLOBAL_POLICY_FILE_SCHEMA || typeof value.overlayVersion !== "string" || typeof value.effectiveAt !== "string" ||
      !rows(value.admissions) || (value.walletPolicies !== undefined && !rows(value.walletPolicies)) ||
      (value.chainPolicies !== undefined && !rows(value.chainPolicies))) {
    throw new ApnError("APN_INVALID_INPUT", `The global policy must be one ${GLOBAL_POLICY_FILE_SCHEMA} object with exactly overlayVersion, effectiveAt, admissions and optional expiresAt, walletPolicies, chainPolicies.`, {
      reason: "invalid_global_policy_file",
    });
  }
  return value as unknown as GlobalAllowlistPolicyFile;
}

async function readPolicyFile(path: string): Promise<unknown> {
  let handle: FileHandle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { throw new ApnError("APN_INVALID_INPUT", `${GLOBAL_POLICY_FILE_ENV} cannot be opened.`, { reason: "global_policy_unreadable" }); }
  try {
    const stats = await handle.stat();
    const uid = process.getuid?.();
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES || (stats.mode & 0o022) !== 0 || (uid !== undefined && stats.uid !== uid && stats.uid !== 0)) {
      throw new ApnError("APN_STATE_SECURITY", "The global policy file must be a regular file owned by the APN user or root and writable by no one else.");
    }
    return JSON.parse((await handle.readFile()).toString("utf8"));
  } catch (error) {
    if (error instanceof ApnError) throw error;
    throw new ApnError("APN_INVALID_INPUT", "The global policy file is not valid JSON.", { reason: "invalid_global_policy_file" });
  } finally { await handle.close(); }
}

const NO_SECRET: WrappingSecretPort = {
  load: async () => { throw new ApnError("APN_INTERNAL", "Public account reads never load the wrapping secret."); },
  create: async () => { throw new ApnError("APN_INTERNAL", "Public account reads never create the wrapping secret."); },
};

/** The profile's own public accounts, read from plaintext records; nothing is decrypted. */
async function profileAccounts(root: string, profile: string): Promise<Partial<Record<(typeof FAMILIES)[number], string>>> {
  const state = new StateStore(root);
  const wallet = await state.loadWallet(state.profileHash(profile));
  const provider = wallet === null ? await state.loadProviderProfile(state.profileHash(profile)) : null;
  const evm = wallet?.address ?? provider?.public_address;
  const chains = new ChainAccountStore(root, NO_SECRET);
  const [solana, tron] = await Promise.all([chains.account(profile, "solana"), chains.account(profile, "tron")]);
  return {
    ...(evm === undefined ? {} : { evm: getAddress(evm) }),
    ...(solana === null ? {} : { solana: solana.address }),
    ...(tron === null ? {} : { tron: tron.address }),
  };
}
