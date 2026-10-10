import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, domainHash, hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, isCode } from "../../secure-state-store.js";
import { validateAssetUsageReservation } from "../../asset-usage-ledger-record.js";
import { validateSwapOperation } from "../model.js";
import { validateJupiterV1ExecutionBinding } from "./v1-effects.js";
import { validateJupiterV1Material, validateJupiterV1PreparedMaterial } from "./v1-material.js";
import { assertHistoricalOrdinaryRecentBlockhash } from "./historical-wire.js";
import { SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT } from "./catalog.js";
import { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
import { hashBucket, validateHistoricalRetirementRecord } from "./historical-retirement-record.js";
import { JupiterHistoricalRetirementReader } from "./historical-retirement-reader.js";
import { HISTORICAL_RETIREMENT_IDENTITY } from "./historical-retirement-record.js";
/** Internal codecs and read validation; no accounting publication or owner capability factory. */
export const PROFILE = "solana-local";
export const NATIVE_IDENTITY = HISTORICAL_RETIREMENT_IDENTITY;
export const USDC_IDENTITY = Object.freeze({ account: NATIVE_IDENTITY.account,
    chain: `solana:${SOLANA_MAINNET_GENESIS}`, asset: Object.freeze({ kind: "token", identifier: SOLANA_USDC_MINT }) });
export const JOURNAL_NAMESPACE = "jupiter-historical-retirement-journals";
export const RECEIPT_NAMESPACE = "jupiter-historical-retirement-receipts";
const JOURNAL_SCHEMA = "apn.jupiter-historical-retirement-journal.v1";
const RECEIPT_SCHEMA = "apn.jupiter-historical-retirement-receipt.v1";
/** Read both daily buckets through SecureStateStore while their shared ledger locks are held. */
class HistoricalUsageBucketReader extends SecureStateStore {
    guard;
    constructor(root, guard) {
        super(root);
        this.guard = guard;
    }
    async load(identity) {
        const directory = `asset-usage/${hashBucket(identity)}`;
        await this.guard.check(["asset-usage"]);
        const entries = await this.readDirectory(directory);
        await this.pinIfPresent(directory);
        const rows = [];
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                corrupt();
            const value = await this.readJson(`${directory}/${entry.name}`);
            if (value === null)
                corrupt();
            const row = validateAssetUsageReservation(value);
            if (`${row.reservationId}.json` !== entry.name || row.account !== identity.account || row.chain !== identity.chain ||
                canonicalJson(row.asset) !== canonicalJson(identity.asset))
                corrupt();
            rows.push(row);
        }
        await this.guard.check(["asset-usage"]);
        await this.pinIfPresent(directory);
        return Object.freeze(rows);
    }
    async pinIfPresent(relativePath) {
        try {
            await lstat(resolve(this.root, relativePath));
            await this.guard.check([relativePath]);
        }
        catch (error) {
            if (!isCode(error, "ENOENT"))
                throw error;
        }
    }
}
export function lockKey(identity) {
    return `asset-usage:${domainHash("apn.asset-usage-lock.v1", canonicalJson(identity))}`;
}
export function assertContext(context) {
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
        context.fresh.lifetime.blockhash !== context.projection.freshBlockhash)
        refuse();
    validateJupiterV1PreparedMaterial(context.material);
    validateJupiterV1Material(context.fresh);
    validateJupiterV1ExecutionBinding(context.binding, operation, context.material);
    assertHistoricalOrdinaryRecentBlockhash(context.effect.rawPayload, context.fresh.rawInstructions);
}
export function canonicalWitness(value) {
    if (value === null || typeof value !== "object" || value.outcome !== "future_invalidity_witness")
        refuse();
    return value;
}
export function journalFor(record) {
    const body = { schemaVersion: JOURNAL_SCHEMA, operationId: record.operationId, recordHash: record.recordHash,
        accountingAt: record.accountingAt };
    return Object.freeze({ ...body, journalHash: hashObject(body) });
}
export function receiptFor(record) {
    const body = { schemaVersion: RECEIPT_SCHEMA, operationId: record.operationId, profile: PROFILE,
        status: "retired_unknown", retirementRecordHash: record.recordHash, accountingAt: record.accountingAt,
        conservativeNativeAmount: "6000000", additionalAdmissionNativeAmount: "5000000",
        effectAt: null, actualNativeFee: null, transactionOutcome: "unknown",
        transactionMayHaveBeenSubmitted: true };
    return Object.freeze({ ...body, receiptHash: hashObject(body) });
}
export function validateJournal(value, expected) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected))
        corrupt();
    return expected;
}
export function validateReceipt(value, expected) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected))
        corrupt();
    return expected;
}
export function publicResult(record, idempotentRecovered) {
    return Object.freeze({ operationId: record.operationId, profile: PROFILE, status: "retired_unknown",
        retirementRecordHash: record.recordHash, accountingAt: record.accountingAt,
        conservativeNativeAmount: "6000000", additionalAdmissionNativeAmount: "5000000",
        effectAt: null, actualNativeFee: null, transactionOutcome: "unknown", transactionMayHaveBeenSubmitted: true,
        idempotentRecovered });
}
export function bucketRowsOriginal(rows, reservationId, expected) {
    const row = rows.find(value => value.reservationId === reservationId);
    if (row === undefined || canonicalJson(row) !== canonicalJson(expected))
        corrupt();
    return row;
}
export async function lstatOptional(path) {
    try {
        return await lstat(path, { bigint: true });
    }
    catch (error) {
        if (isCode(error, "ENOENT"))
            return null;
        throw error;
    }
}
export function corrupt() {
    throw new ApnError("APN_STATE_CORRUPT", "Historical Jupiter retirement state is inconsistent or not create-only.");
}
export function refuse() {
    throw new ApnError("APN_OPERATION_BLOCKED", "The fixed Jupiter historical retirement could not be safely committed.");
}
export function scopeDeadline(context) {
    const deadline = Date.parse(context.deadline);
    if (!Number.isFinite(deadline) || new Date(deadline).toISOString() !== context.deadline || deadline <= Date.now())
        refuse();
    return deadline;
}
export async function loadRetirements(root, rows) {
    return await new JupiterHistoricalRetirementReader(root).forBucket(NATIVE_IDENTITY, rows);
}
export async function readRowsAndRetirements(root, context) {
    const guard = context.state.directoryGuard(), buckets = new HistoricalUsageBucketReader(root, guard);
    const native = await buckets.load(NATIVE_IDENTITY), usdc = await buckets.load(USDC_IDENTITY);
    const retirements = await loadRetirements(root, native);
    return { native, usdc, retirements };
}
export function retirementFileStatValid(value, parentDev, expectedLinks) {
    return value.isFile() && !value.isSymbolicLink() &&
        value.uid === BigInt(process.geteuid?.() ?? -1) && (value.mode & 511n) === 384n &&
        value.dev === parentDev && value.nlink === expectedLinks && value.size > 0n && value.size <= 1048576n;
}
export function projectionFileStatValid(value, parentDev, expectedLinks, expectedBytes) {
    return value.isFile() && !value.isSymbolicLink() &&
        value.uid === BigInt(process.geteuid?.() ?? -1) && (value.mode & 511n) === 384n &&
        value.dev === parentDev && value.nlink === expectedLinks && value.size === BigInt(expectedBytes.byteLength);
}
export function fileStatFacts(value) {
    return canonicalJson({ dev: String(value.dev), ino: String(value.ino),
        uid: String(value.uid), mode: String(value.mode), nlink: String(value.nlink), size: String(value.size),
        mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) });
}
export function decodeRetirementBytes(bytes) {
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        corrupt();
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        corrupt();
    }
    const record = validateHistoricalRetirementRecord(parsed);
    if (text !== `${canonicalJson(record)}\n`)
        corrupt();
    return record;
}
export async function assertNoOrphanPostCommit(store, operationId) {
    const journal = await store.read(`${JOURNAL_NAMESPACE}/${operationId}.json`);
    const receipt = await store.read(`${RECEIPT_NAMESPACE}/${operationId}.json`);
    if (journal !== null || receipt !== null)
        corrupt();
}
/** Read-only bucket adapter; the SecureStateStore subclass remains private. */
export async function loadHistoricalUsageBucket(root, guard, identity) {
    return await new HistoricalUsageBucketReader(root, guard).load(identity);
}
export async function loadHistoricalUsageBuckets(root, guard) {
    const buckets = new HistoricalUsageBucketReader(root, guard);
    const native = await buckets.load(NATIVE_IDENTITY), usdc = await buckets.load(USDC_IDENTITY);
    return { native, usdc };
}
//# sourceMappingURL=historical-retirement-validation.js.map