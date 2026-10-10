import type { BigIntStats } from "node:fs";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, domainHash, hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, isCode } from "../../secure-state-store.js";
import { validateAssetUsageReservation } from "../../asset-usage-ledger-record.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { validateSwapOperation } from "../model.js";
import { validateJupiterV1ExecutionBinding } from "./v1-effects.js";
import { validateJupiterV1Material, validateJupiterV1PreparedMaterial } from "./v1-material.js";
import { assertHistoricalOrdinaryRecentBlockhash } from "./historical-wire.js";
import { SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT } from "./catalog.js";
import { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
import { hashBucket, validateHistoricalRetirementRecord, type HistoricalRetirementCanonicalWitness, type HistoricalRetirementRecord } from "./historical-retirement-record.js";
import { JupiterHistoricalRetirementReader } from "./historical-retirement-reader.js";
import { HISTORICAL_RETIREMENT_IDENTITY } from "./historical-retirement-record.js";
import type { HistoricalDirectoryGuard } from "./historical-authentication-readers.js";
import type { OwnedJupiterHistoricalRetirementContext, OwnedJupiterHistoricalRetirementAuthority, JupiterHistoricalRetirementPublicResult } from "./historical-retirement-owner.js";

/** Internal codecs and read validation; no accounting publication or owner capability factory. */
export const PROFILE = "solana-local";
export const NATIVE_IDENTITY = HISTORICAL_RETIREMENT_IDENTITY;
export const USDC_IDENTITY: AssetUsageIdentity = Object.freeze({ account: NATIVE_IDENTITY.account,
  chain: `solana:${SOLANA_MAINNET_GENESIS}`, asset: Object.freeze({ kind: "token", identifier: SOLANA_USDC_MINT }) });
export const JOURNAL_NAMESPACE = "jupiter-historical-retirement-journals";
export const RECEIPT_NAMESPACE = "jupiter-historical-retirement-receipts";
const JOURNAL_SCHEMA = "apn.jupiter-historical-retirement-journal.v1" as const;
const RECEIPT_SCHEMA = "apn.jupiter-historical-retirement-receipt.v1" as const;

export interface RetirementJournal {
  readonly schemaVersion: typeof JOURNAL_SCHEMA;
  readonly operationId: string;
  readonly recordHash: string;
  readonly accountingAt: string;
  readonly journalHash: string;
}
export interface RetirementReceipt {
  readonly schemaVersion: typeof RECEIPT_SCHEMA;
  readonly operationId: string;
  readonly profile: "solana-local";
  readonly status: "retired_unknown";
  readonly retirementRecordHash: string;
  readonly accountingAt: string;
  readonly conservativeNativeAmount: "6000000";
  readonly additionalAdmissionNativeAmount: "5000000";
  readonly effectAt: null;
  readonly actualNativeFee: null;
  readonly transactionOutcome: "unknown";
  readonly transactionMayHaveBeenSubmitted: true;
  readonly receiptHash: string;
}

export type RetirementProjectionNamespace = typeof JOURNAL_NAMESPACE | typeof RECEIPT_NAMESPACE;

export interface ProjectionTempCleanup {
  readonly namespace: RetirementProjectionNamespace;
  readonly targetPath: string;
  readonly temporaryPath: string;
  readonly parentPath: string;
  readonly parentDev: bigint;
  readonly tempDev: bigint;
  readonly tempIno: bigint;
  readonly targetIno: bigint | null;
  readonly expectedBytes: Buffer;
}

/** Read both daily buckets through SecureStateStore while their shared ledger locks are held. */
class HistoricalUsageBucketReader extends SecureStateStore {
  constructor(root: string, private readonly guard: HistoricalDirectoryGuard) {
    super(root);
  }

  async load(identity: AssetUsageIdentity): Promise<readonly AssetUsageReservation[]> {
    const directory = `asset-usage/${hashBucket(identity)}`;
    await this.guard.check(["asset-usage"]);
    const entries = await this.readDirectory(directory);
    await this.pinIfPresent(directory);
    const rows: AssetUsageReservation[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt();
      const value = await this.readJson(`${directory}/${entry.name}`);
      if (value === null) corrupt();
      const row = validateAssetUsageReservation(value);
      if (`${row.reservationId}.json` !== entry.name || row.account !== identity.account || row.chain !== identity.chain ||
          canonicalJson(row.asset) !== canonicalJson(identity.asset)) corrupt();
      rows.push(row);
    }
    await this.guard.check(["asset-usage"]);
    await this.pinIfPresent(directory);
    return Object.freeze(rows);
  }

  private async pinIfPresent(relativePath: string): Promise<void> {
    try {
      await lstat(resolve(this.root, relativePath));
      await this.guard.check([relativePath]);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }
  }
}

export function lockKey(identity: AssetUsageIdentity): string {
  return `asset-usage:${domainHash("apn.asset-usage-lock.v1", canonicalJson(identity))}`;
}

export function assertContext(context: OwnedJupiterHistoricalRetirementContext): void {
  const operation = validateSwapOperation(context.operation);
  if (!HISTORICAL_JUPITER_IDS.some(id => id === operation.operationId) || operation.quote.profile !== PROFILE ||
      operation.ownerProfileHash !== context.projection.ownerProfileHash || operation.integrityHash !== context.projection.operationIntegrityHash ||
      context.projection.rootBinding !== hashObject({ root: context.state.root }) ||
      operation.usageLease === null || context.projection.operationId !== operation.operationId ||
      context.projection.authenticationExpiresAt !== context.deadline || context.binding.operationId !== operation.operationId ||
      context.binding.markerHash !== operation.submissionMarker?.markerHash || context.effect.operationId !== operation.operationId ||
      context.effect.transactionId !== context.projection.signature || context.effect.rawPayloadHash !== context.projection.rawPayloadHash ||
      context.binding.messageHash !== context.projection.messageHash || context.binding.freshMaterialDigest !== context.fresh.materialDigest ||
      context.material.execution.quoteRpcLifetime === undefined || context.material.execution.quoteRpcLifetime.blockhash !== context.projection.blockhash ||
      context.fresh.lifetime.blockhash !== context.projection.freshBlockhash) refuse();
  validateJupiterV1PreparedMaterial(context.material);
  validateJupiterV1Material(context.fresh);
  validateJupiterV1ExecutionBinding(context.binding, operation, context.material);
  assertHistoricalOrdinaryRecentBlockhash(context.effect.rawPayload, context.fresh.rawInstructions);
}

export function canonicalWitness(value: unknown): HistoricalRetirementCanonicalWitness {
  if (value === null || typeof value !== "object" || (value as { outcome?: unknown }).outcome !== "future_invalidity_witness") refuse();
  return value as HistoricalRetirementCanonicalWitness;
}

export function journalFor(record: HistoricalRetirementRecord): RetirementJournal {
  const body = { schemaVersion: JOURNAL_SCHEMA, operationId: record.operationId, recordHash: record.recordHash,
    accountingAt: record.accountingAt };
  return Object.freeze({ ...body, journalHash: hashObject(body) });
}

export function receiptFor(record: HistoricalRetirementRecord): RetirementReceipt {
  const body = { schemaVersion: RECEIPT_SCHEMA, operationId: record.operationId, profile: PROFILE as "solana-local",
    status: "retired_unknown" as const, retirementRecordHash: record.recordHash, accountingAt: record.accountingAt,
    conservativeNativeAmount: "6000000" as const, additionalAdmissionNativeAmount: "5000000" as const,
    effectAt: null, actualNativeFee: null, transactionOutcome: "unknown" as const,
    transactionMayHaveBeenSubmitted: true as const };
  return Object.freeze({ ...body, receiptHash: hashObject(body) });
}

export function validateJournal(value: unknown, expected: RetirementJournal): RetirementJournal {
  if (value === null || typeof value !== "object" || Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected)) corrupt();
  return expected;
}

export function validateReceipt(value: unknown, expected: RetirementReceipt): RetirementReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected)) corrupt();
  return expected;
}

export function publicResult(record: HistoricalRetirementRecord, idempotentRecovered: boolean): JupiterHistoricalRetirementPublicResult {
  return Object.freeze({ operationId: record.operationId, profile: PROFILE, status: "retired_unknown",
    retirementRecordHash: record.recordHash, accountingAt: record.accountingAt,
    conservativeNativeAmount: "6000000", additionalAdmissionNativeAmount: "5000000",
    effectAt: null, actualNativeFee: null, transactionOutcome: "unknown", transactionMayHaveBeenSubmitted: true,
    idempotentRecovered });
}

export function bucketRowsOriginal(rows: readonly AssetUsageReservation[], reservationId: string,
  expected: AssetUsageReservation): AssetUsageReservation {
  const row = rows.find(value => value.reservationId === reservationId);
  if (row === undefined || canonicalJson(row) !== canonicalJson(expected)) corrupt();
  return row;
}

export async function lstatOptional(path: string): Promise<BigIntStats | null> {
  try { return await lstat(path, { bigint: true }); }
  catch (error) { if (isCode(error, "ENOENT")) return null; throw error; }
}

export function corrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "Historical Jupiter retirement state is inconsistent or not create-only.");
}
export function refuse(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "The fixed Jupiter historical retirement could not be safely committed.");
}

export function scopeDeadline(context: OwnedJupiterHistoricalRetirementContext): number {
  const deadline = Date.parse(context.deadline);
  if (!Number.isFinite(deadline) || new Date(deadline).toISOString() !== context.deadline || deadline <= Date.now()) refuse();
  return deadline;
}

export async function loadRetirements(root: string, rows: readonly AssetUsageReservation[]): Promise<readonly HistoricalRetirementRecord[]> {
  return await new JupiterHistoricalRetirementReader(root).forBucket(NATIVE_IDENTITY, rows);
}

export async function readRowsAndRetirements(root: string, context: OwnedJupiterHistoricalRetirementContext): Promise<{
  native: readonly AssetUsageReservation[]; usdc: readonly AssetUsageReservation[];
  retirements: readonly HistoricalRetirementRecord[];
}> {
  const guard = context.state.directoryGuard(), buckets = new HistoricalUsageBucketReader(root, guard);
  const native = await buckets.load(NATIVE_IDENTITY), usdc = await buckets.load(USDC_IDENTITY);
  const retirements = await loadRetirements(root, native);
  return { native, usdc, retirements };
}

export function retirementFileStatValid(value: BigIntStats, parentDev: bigint, expectedLinks: bigint): boolean {
  return value.isFile() && !value.isSymbolicLink() &&
    value.uid === BigInt(process.geteuid?.() ?? -1) && (value.mode & 0o777n) === 0o600n &&
    value.dev === parentDev && value.nlink === expectedLinks && value.size > 0n && value.size <= 1_048_576n;
}

export function projectionFileStatValid(value: BigIntStats, parentDev: bigint, expectedLinks: bigint, expectedBytes: Buffer): boolean {
  return value.isFile() && !value.isSymbolicLink() &&
    value.uid === BigInt(process.geteuid?.() ?? -1) && (value.mode & 0o777n) === 0o600n &&
    value.dev === parentDev && value.nlink === expectedLinks && value.size === BigInt(expectedBytes.byteLength);
}

export function fileStatFacts(value: BigIntStats): string {
  return canonicalJson({ dev: String(value.dev), ino: String(value.ino),
    uid: String(value.uid), mode: String(value.mode), nlink: String(value.nlink), size: String(value.size),
    mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) });
}

export function decodeRetirementBytes(bytes: Buffer): HistoricalRetirementRecord {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { corrupt(); }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { corrupt(); }
  const record = validateHistoricalRetirementRecord(parsed);
  if (text !== `${canonicalJson(record)}\n`) corrupt();
  return record;
}

export async function assertNoOrphanPostCommit(store: { read(path: string): Promise<unknown | null> }, operationId: string): Promise<void> {
  const journal = await store.read(`${JOURNAL_NAMESPACE}/${operationId}.json`);
  const receipt = await store.read(`${RECEIPT_NAMESPACE}/${operationId}.json`);
  if (journal !== null || receipt !== null) corrupt();
}

export interface RetirementPublicationFrame {
  readonly token: OwnedJupiterHistoricalRetirementAuthority;
  readonly context: OwnedJupiterHistoricalRetirementContext;
  readonly record: HistoricalRetirementRecord;
}

/** Read-only bucket adapter; the SecureStateStore subclass remains private. */
export async function loadHistoricalUsageBucket(root: string, guard: HistoricalDirectoryGuard,
  identity: AssetUsageIdentity): Promise<readonly AssetUsageReservation[]> {
  return await new HistoricalUsageBucketReader(root, guard).load(identity);
}

export async function loadHistoricalUsageBuckets(root: string, guard: HistoricalDirectoryGuard): Promise<{
  native: readonly AssetUsageReservation[]; usdc: readonly AssetUsageReservation[];
}> {
  const buckets = new HistoricalUsageBucketReader(root, guard);
  const native = await buckets.load(NATIVE_IDENTITY), usdc = await buckets.load(USDC_IDENTITY);
  return { native, usdc };
}
