import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
/** Public Polygon providers used by the live recovery rejected 261-block log ranges despite advertising a larger limit. */
export const STARGATE_POLYGON_SCAN_WINDOW = 100n;
/** mainnet.unichain.org and unichain-rpc.publicnode.com answered 2,000-block filtered ranges on 2026-10-16. */
export const STARGATE_UNICHAIN_SCAN_WINDOW = 1000n;
/** Windows one observe may scan; a later observe resumes from the saved cursor, so a late delivery never dead-ends. */
export const STARGATE_SCAN_WINDOWS_PER_CALL = 32;
const SCHEMA = "apn.stargate-destination-scan.v1";
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Stargate destination scan cursor is invalid."); }
/** Providers may repeat a log; an identical repeat is dropped, a conflicting one at the same position fails closed. */
function unique(logs) {
    const seen = new Map();
    for (const value of logs) {
        const key = `${String(value.transactionHash).toLowerCase()}:${String(value.logIndex).toLowerCase()}`, raw = JSON.stringify(value), previous = seen.get(key);
        if (previous !== undefined && previous.raw !== raw)
            throw new ApnError("APN_RPC_PROTOCOL", "Stargate destination logs conflict.");
        seen.set(key, { raw, value });
    }
    return [...seen.values()].map(item => item.value);
}
function record(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC log.");
    return value;
}
/** Durable progress of one operation's destination scan. It only ever records the first block not yet scanned, and only
 * after every earlier window up to the finality head returned no matching log, so resuming from it cannot skip a delivery. */
export class StargateDestinationScanStore extends SecureStateStore {
    cursor(operationId, scope) {
        stateIdentifier(operationId, "Stargate operation");
        const directory = "stargate-destination-scans", path = `${directory}/${operationId}.${scope}.json`;
        return {
            load: async () => {
                const value = await this.readJson(path);
                if (value === null)
                    return null;
                const row = record(value);
                if (Object.keys(row).sort().join(",") !== "nextBlockAtomic,operationId,schemaVersion,scope" || row.schemaVersion !== SCHEMA ||
                    row.operationId !== operationId || row.scope !== scope || typeof row.nextBlockAtomic !== "string" ||
                    !/^(?:0|[1-9][0-9]{0,30})$/u.test(row.nextBlockAtomic))
                    corrupt();
                return BigInt(row.nextBlockAtomic);
            },
            save: async (nextBlock) => {
                await this.initialize();
                await this.ensureDirectory(directory);
                await this.writeJson(path, { schemaVersion: SCHEMA, operationId, scope, nextBlockAtomic: nextBlock.toString() });
            },
        };
    }
}
/**
 * Filtered `eth_getLogs` in bounded windows from `max(from, cursor)` up to the finality head `to` (BRDG-30). Returns the
 * first window's logs that match the indexed filter (the caller validates them), or none after at most `maxWindows`
 * windows; the cursor then advances to the first block not yet scanned. A filter by GUID and recipient topics returns
 * at most the one delivery instead of every pool event.
 */
export async function scanStargateLogs(call, filter, from, to, window, cursor, maxWindows = STARGATE_SCAN_WINDOWS_PER_CALL) {
    const saved = await cursor?.load() ?? null;
    let start = saved !== null && saved > from ? saved : from;
    if (window < 1n)
        throw new ApnError("APN_RPC_CONFIG", "Stargate destination scan window is invalid.");
    for (let scanned = 0; scanned < maxWindows && start <= to; scanned++) {
        const end = start + window - 1n > to ? to : start + window - 1n;
        const raw = await call("eth_getLogs", [{ address: filter.address, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: filter.topics }]);
        if (!Array.isArray(raw) || raw.length > 5_000)
            throw new ApnError("APN_RPC_PROTOCOL", "Stargate destination logs are malformed.");
        if (raw.length > 0) {
            if (cursor !== undefined && start !== saved)
                await cursor.save(start);
            return unique(raw.map(record));
        }
        start = end + 1n;
    }
    if (cursor !== undefined && start !== saved && start > from)
        await cursor.save(start);
    return [];
}
//# sourceMappingURL=destination-scan.js.map