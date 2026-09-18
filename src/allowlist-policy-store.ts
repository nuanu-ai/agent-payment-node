import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { loadAllowlistInventory } from "./allowlist-inventory.js";
import {
  ALLOWLIST_POLICY_RECORD_SCHEMA,
  allowlistProfileHash,
  compileAllowlistPolicyOverlay,
  isoInstant,
  validateAllowlistPolicyRecord,
  type AllowlistPolicyRecord,
  type PrepareAllowlistPolicyInput,
} from "./allowlist-policy-overlay.js";
import {
  ALLOWLIST_POLICY_RECORD_SCHEMA_V2,
  compileAllowlistPolicyOverlayV2,
  parseAllowlistPolicyFile,
  sealAllowlistPolicyRecordV2,
  validateAllowlistPolicyRecordV2,
  type AllowlistPolicyAccounts,
  type AllowlistPolicyFile,
  type AllowlistPolicyRecordV2,
} from "./allowlist-policy-v2.js";
import { validateAssetPolicyRegistry, type AssetPolicyRegistry } from "./asset-policy-registry.js";
import { SecureStateStore, stateCorrupt } from "./secure-state-store.js";

export const ALLOWLIST_POLICY_ACTIVATION_SCHEMA = "apn.allowlist-policy-activation.v1" as const;
const DIGEST = /^[a-f0-9]{64}$/u;

export type StagedAllowlistPolicyRecord = AllowlistPolicyRecord | AllowlistPolicyRecordV2;

/** One sealed, hash-chained owner decision. The newest entry is the profile's current activation state. */
export interface AllowlistPolicyActivationEntry {
  readonly schemaVersion: typeof ALLOWLIST_POLICY_ACTIVATION_SCHEMA;
  readonly profileHash: string;
  readonly sequence: number;
  readonly previousEntryDigest: string | null;
  readonly status: "active" | "revoked";
  readonly revision: number;
  readonly stagedRecordDigest: string;
  readonly policyDigest: string;
  /** The exact ACTIVE registry; present only on an active entry. */
  readonly registry?: AssetPolicyRegistry;
  readonly approvalFingerprint: string;
  readonly decidedAt: string;
  readonly entryDigest: string;
}

export type AllowlistPolicyDecision = Pick<AllowlistPolicyActivationEntry,
  "status" | "revision" | "stagedRecordDigest" | "policyDigest" | "registry" | "approvalFingerprint" | "decidedAt">;

/** One authenticated read of a profile: every staged revision and the complete activation chain. */
export interface AllowlistPolicyState {
  readonly profile: string;
  readonly profileHash: string;
  readonly records: readonly StagedAllowlistPolicyRecord[];
  readonly entries: readonly AllowlistPolicyActivationEntry[];
}

export interface StageAllowlistPolicyInput {
  readonly profile: string;
  readonly policy: AllowlistPolicyFile;
  readonly expectedRevision?: number;
  readonly now: Date;
}

export class AllowlistPolicyStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;

  /** Version 1 single-admission staging, retained for the flag-based `prepare` command. */
  async prepare(input: PrepareAllowlistPolicyInput): Promise<AllowlistPolicyRecord> {
    const { expectedRevision, now, ...overlayInputValue } = input;
    const compiled = compileAllowlistPolicyOverlay(overlayInputValue);
    const preparedAt = instant(now);
    const family = compiled.registry.chains[0]!.family;
    return await this.writeRevision(compiled.overlay.profile, expectedRevision, { [family]: compiled.overlay.account },
      compiled.overlay.overlayVersion, async (revision) => {
        const body = { schemaVersion: ALLOWLIST_POLICY_RECORD_SCHEMA, revision, status: "staged_unadmitted" as const,
          preparedAt, overlay: compiled.overlay, registry: compiled.registry };
        return validateAllowlistPolicyRecord({ ...body, recordDigest: domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA, canonicalJson(body)) });
      });
  }

  /** Stage one multi-admission, multi-family revision. Staging never grants execution authority. */
  async stage(input: StageAllowlistPolicyInput): Promise<AllowlistPolicyRecordV2> {
    const inventory = loadAllowlistInventory();
    const { schemaVersion: _schema, ...policy } = parseAllowlistPolicyFile(input.policy);
    const compiled = compileAllowlistPolicyOverlayV2({ ...policy, profile: input.profile,
      datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256 },
    inventory);
    const preparedAt = instant(input.now);
    return await this.writeRevision(input.profile, input.expectedRevision, compiled.overlay.accounts, compiled.overlay.overlayVersion,
      async (revision) => sealAllowlistPolicyRecordV2({ schemaVersion: ALLOWLIST_POLICY_RECORD_SCHEMA_V2, revision,
        status: "staged_unadmitted", preparedAt, overlay: compiled.overlay, registry: compiled.registry }));
  }

  /** The latest staged revision, authenticated. */
  async status(profile: string): Promise<StagedAllowlistPolicyRecord | null> {
    return (await this.read(profile)).records.at(-1) ?? null;
  }

  async read(profile: string): Promise<AllowlistPolicyState> {
    const profileHash = allowlistProfileHash(profile);
    await this.ready();
    return await this.withLocks([lockKey(profileHash)], async () => await this.load(profile, profileHash));
  }

  /** Append one decision only if the chain head still equals the head the human approved against. */
  async appendDecision(profile: string, expectedHeadDigest: string | null, decision: AllowlistPolicyDecision): Promise<AllowlistPolicyActivationEntry> {
    const profileHash = allowlistProfileHash(profile);
    await this.ready();
    return await this.withLocks([lockKey(profileHash)], async () => {
      const state = await this.load(profile, profileHash);
      const head = state.entries.at(-1) ?? null;
      if ((head?.entryDigest ?? null) !== expectedHeadDigest) conflict("The allowlist activation state changed after the approval screen.");
      const record = state.records.find((entry) => entry.revision === decision.revision);
      if (record === undefined || record.recordDigest !== decision.stagedRecordDigest || record.registry.policyDigest !== decision.policyDigest ||
          (decision.registry !== undefined && canonicalJson(decision.registry) !== canonicalJson(record.registry))) {
        conflict("The staged allowlist revision changed after the approval screen.");
      }
      const entry = sealEntry({ schemaVersion: ALLOWLIST_POLICY_ACTIVATION_SCHEMA, profileHash, sequence: (head?.sequence ?? 0) + 1,
        previousEntryDigest: head?.entryDigest ?? null, ...decision });
      await this.ensureDirectory(`allowlist-activations/${profileHash}`);
      await this.writeJson(entryPath(profileHash, entry.sequence), entry, true);
      return entry;
    });
  }

  private async writeRevision<T extends StagedAllowlistPolicyRecord>(profile: string, expectedRevision: number | undefined,
    accounts: AllowlistPolicyAccounts, overlayVersion: string, build: (revision: number) => Promise<T>): Promise<T> {
    const profileHash = allowlistProfileHash(profile);
    await this.ready();
    return await this.withLocks([lockKey(profileHash)], async () => {
      const state = await this.load(profile, profileHash);
      const current = state.records.at(-1);
      if (current === undefined) {
        if (expectedRevision !== undefined) conflict("The initial allowlist policy must omit expected revision.");
      } else if (expectedRevision === undefined || expectedRevision !== current.revision) {
        conflict("Allowlist policy expected revision does not match durable state.");
      }
      if (current !== undefined) {
        const bound = stagedRecordAccounts(current);
        for (const family of ["evm", "solana", "tron"] as const) {
          if (bound[family] !== undefined && accounts[family] !== undefined && bound[family] !== accounts[family]) {
            throw new ApnError("APN_PROFILE_DRIFT", "The allowlist policy profile is already bound to a different owner account.");
          }
        }
      }
      if (state.records.some((record) => record.overlay.overlayVersion === overlayVersion)) {
        throw new ApnError("APN_INVALID_INPUT", "Each staged revision needs a new overlay version.", { reason: "overlay_version_reused" });
      }
      const record = await build((current?.revision ?? 0) + 1);
      await this.ensureDirectory(`allowlist-policies/${profileHash}`);
      await this.writeJson(recordPath(profileHash, record.revision), record, true);
      return record;
    });
  }

  private async load(profile: string, profileHash: string): Promise<AllowlistPolicyState> {
    const records: StagedAllowlistPolicyRecord[] = [];
    for (const entry of await this.readDirectory(`allowlist-policies/${profileHash}`)) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^v[0-9]{8}\.json$/u.test(entry.name)) {
        corrupt("Allowlist policy directory contains an unsafe entry.");
      }
      const record = validateStagedAllowlistPolicyRecord(await this.readJson(`allowlist-policies/${profileHash}/${entry.name}`));
      if (record.overlay.profileHash !== profileHash || entry.name !== `v${String(record.revision).padStart(8, "0")}.json`) {
        corrupt("Allowlist policy path binding is invalid.");
      }
      records.push(record);
    }
    records.sort((left, right) => left.revision - right.revision);
    if (records.some((record, index) => record.revision !== index + 1)) corrupt("Allowlist policy revisions are not contiguous.");
    const entries: AllowlistPolicyActivationEntry[] = [];
    for (const entry of await this.readDirectory(`allowlist-activations/${profileHash}`)) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^e[0-9]{8}\.json$/u.test(entry.name)) {
        corrupt("Allowlist activation directory contains an unsafe entry.");
      }
      const value = validateActivationEntry(await this.readJson(`allowlist-activations/${profileHash}/${entry.name}`));
      if (value.profileHash !== profileHash || entry.name !== `e${String(value.sequence).padStart(8, "0")}.json`) {
        corrupt("Allowlist activation path binding is invalid.");
      }
      entries.push(value);
    }
    entries.sort((left, right) => left.sequence - right.sequence);
    entries.forEach((entry, index) => {
      const record = records.find((candidate) => candidate.revision === entry.revision);
      if (entry.sequence !== index + 1 || entry.previousEntryDigest !== (entries[index - 1]?.entryDigest ?? null) ||
          record === undefined || record.recordDigest !== entry.stagedRecordDigest || record.registry.policyDigest !== entry.policyDigest ||
          (entry.registry !== undefined && canonicalJson(entry.registry) !== canonicalJson(record.registry))) {
        corrupt("Allowlist activation chain does not match its staged revisions.");
      }
    });
    return { profile, profileHash, records, entries };
  }

  private async ready(): Promise<void> {
    this.initialized ??= (async () => {
      await this.initialize();
      await this.ensureDirectory("allowlist-policies");
      await this.ensureDirectory("allowlist-activations");
    })();
    await this.initialized;
  }
}

export function validateStagedAllowlistPolicyRecord(value: unknown): StagedAllowlistPolicyRecord {
  if (value === null) corrupt("Allowlist policy version disappeared during validation.");
  if (isPlainRecord(value) && value.schemaVersion === ALLOWLIST_POLICY_RECORD_SCHEMA_V2) return validateAllowlistPolicyRecordV2(value);
  try { return validateAllowlistPolicyRecord(value); }
  catch (error) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") throw error;
    return corrupt("Allowlist policy record no longer compiles against the frozen inventory.");
  }
}

export function stagedRecordAccounts(record: StagedAllowlistPolicyRecord): AllowlistPolicyAccounts {
  return record.schemaVersion === ALLOWLIST_POLICY_RECORD_SCHEMA_V2
    ? record.overlay.accounts : { [record.registry.chains[0]!.family]: record.overlay.account };
}

export function validateActivationEntry(value: unknown): AllowlistPolicyActivationEntry {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profileHash", "sequence", "previousEntryDigest", "status", "revision",
    "stagedRecordDigest", "policyDigest", ...(value.status === "active" ? ["registry"] : []), "approvalFingerprint", "decidedAt", "entryDigest"]) ||
      value.schemaVersion !== ALLOWLIST_POLICY_ACTIVATION_SCHEMA || (value.status !== "active" && value.status !== "revoked") ||
      !digest(value.profileHash) || !positive(value.sequence) || !positive(value.revision) ||
      (value.sequence === 1 ? value.previousEntryDigest !== null : !digest(value.previousEntryDigest)) ||
      !digest(value.stagedRecordDigest) || !digest(value.policyDigest) || !digest(value.approvalFingerprint) ||
      typeof value.decidedAt !== "string" || !isoInstant(value.decidedAt) || !digest(value.entryDigest)) {
    corrupt("Allowlist activation entry schema is invalid.");
  }
  if (value.status === "active") {
    let registry: AssetPolicyRegistry;
    try { registry = validateAssetPolicyRegistry(value.registry); } catch { return corrupt("Allowlist active registry is invalid."); }
    if (registry.policyDigest !== value.policyDigest) corrupt("Allowlist active registry digest binding is invalid.");
  }
  const { entryDigest, ...body } = value;
  if (domainHash(ALLOWLIST_POLICY_ACTIVATION_SCHEMA, canonicalJson(body)) !== entryDigest) {
    corrupt("Allowlist activation entry integrity validation failed.");
  }
  return value as unknown as AllowlistPolicyActivationEntry;
}

function sealEntry(body: Omit<AllowlistPolicyActivationEntry, "entryDigest">): AllowlistPolicyActivationEntry {
  return validateActivationEntry({ ...body, entryDigest: domainHash(ALLOWLIST_POLICY_ACTIVATION_SCHEMA, canonicalJson(body)) });
}

function lockKey(profileHash: string): string { return `profile:${profileHash}`; }
function recordPath(profileHash: string, revision: number): string {
  return `allowlist-policies/${profileHash}/v${String(revision).padStart(8, "0")}.json`;
}
function entryPath(profileHash: string, sequence: number): string {
  return `allowlist-activations/${profileHash}/e${String(sequence).padStart(8, "0")}.json`;
}
function digest(value: unknown): boolean { return typeof value === "string" && DIGEST.test(value); }
function positive(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1; }
function instant(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ApnError("APN_INVALID_INPUT", "Preparation time is invalid.", { reason: "invalid_time" });
  }
  return value.toISOString();
}
function conflict(message: string): never {
  throw new ApnError("APN_PROFILE_REVISION_CONFLICT", message, { reason: "stale_policy_revision" });
}
function corrupt(message: string): never { return stateCorrupt(message); }
