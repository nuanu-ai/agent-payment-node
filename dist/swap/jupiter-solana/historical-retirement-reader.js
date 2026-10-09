import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { canonicalJson, hashObject, sha256 } from "../../canonical.js";
import { SecureStateStore, validateDirectory } from "../../secure-state-store.js";
import { SwapOperationRepository } from "../repository.js";
import { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
import { HISTORICAL_RETIREMENT_IDENTITY, HISTORICAL_RETIREMENT_NAMESPACE, assertHistoricalRetirementBindings, hashBucket, sameIdentity, validateHistoricalRetirementRecord } from "./historical-retirement-record.js";
import { ApnError } from "../../errors.js";
/** Existing-owned public records only. No initialize/create/commit/mint method is provided. */
export class JupiterHistoricalRetirementReader extends SecureStateStore {
    async initialize() { await historicalRetirementRootSnapshot(this.root); }
    async ensureDirectory() { corrupt(); }
    async forBucket(identity, rows) {
        if (!sameIdentity(identity, HISTORICAL_RETIREMENT_IDENTITY))
            return [];
        const entries = await this.readDirectory(HISTORICAL_RETIREMENT_NAMESPACE);
        if (entries.length === 0)
            return [];
        const rootSnapshotHash = await historicalRetirementRootSnapshot(this.root), records = [];
        for (const e of entries) {
            if (!e.isFile() || e.isSymbolicLink() || !HISTORICAL_JUPITER_IDS.some(id => `${id}.json` === e.name))
                corrupt();
            const value = await this.readJson(`${HISTORICAL_RETIREMENT_NAMESPACE}/${e.name}`), record = validateHistoricalRetirementRecord(value);
            if (`${record.operationId}.json` !== e.name || record.authentication.rootBinding !== hashObject({ root: this.root }))
                corrupt();
            const row = rows.find(r => r.reservationId === record.originalOperation.usageLease.reservationId);
            if (row === undefined)
                corrupt();
            const rawHash = await this.originalRowRawHash(identity, row.reservationId), operation = await new SwapOperationRepository(this.root).loadAny(record.operationId);
            assertHistoricalRetirementBindings(record, rootSnapshotHash, operation, row, rawHash);
            records.push(record);
        }
        if (rootSnapshotHash !== await historicalRetirementRootSnapshot(this.root))
            corrupt();
        return Object.freeze(records);
    }
    async writeJson() { corrupt(); }
    async originalRowRawHash(identity, id) {
        const path = this.resolveRelative(`asset-usage/${hashBucket(identity)}/${id}.json`);
        await this.assertNoSymlinkAncestors(path);
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const before = await handle.stat({ bigint: true }), leaf = await lstat(path, { bigint: true });
            const valid = (s) => s.isFile() && !s.isSymbolicLink() && s.uid === BigInt(process.geteuid?.() ?? -1) && (s.mode & 511n) === 384n && s.nlink === 1n && s.size > 0n && s.size <= 1048576n;
            const facts = (s) => canonicalJson({ dev: String(s.dev), ino: String(s.ino), uid: String(s.uid), mode: String(s.mode), nlink: String(s.nlink), size: String(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
            if (!valid(before) || !valid(leaf) || facts(before) !== facts(leaf))
                corrupt();
            const bytes = await handle.readFile(), after = await lstat(path, { bigint: true });
            await this.assertNoSymlinkAncestors(path);
            if (!valid(after) || facts(before) !== facts(after))
                corrupt();
            return sha256(bytes);
        }
        finally {
            await handle.close();
        }
    }
}
/** Pin local identity at commit and compare it on every later read; never hardcode host inode values. */
export async function historicalRetirementRootSnapshot(root) {
    const before = await lstat(root);
    validateDirectory(before, true);
    if (await realpath(root) !== root)
        corrupt();
    const after = await lstat(root);
    validateDirectory(after, true);
    if (before.dev !== after.dev || before.ino !== after.ino)
        corrupt();
    return hashObject({ root, uid: String(after.uid), dev: String(after.dev), ino: String(after.ino) });
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Historical Jupiter retirement path or original row changed."); }
//# sourceMappingURL=historical-retirement-reader.js.map