import { type SolanaRpcPort } from "../solana/rpc.js";
/** PublicNode, the strictest keyless public endpoint, answers at most eight keys per getMultipleAccounts. */
export declare const SOLANA_ACCOUNT_KEYS_PER_READ = 8;
export interface SolanaAccountPagesRead {
    /** The highest page slot: a later read pinned to it (minContextSlot) is never behind any page. */
    readonly slot: bigint;
    /** The context slot each key was answered at, in key order. */
    readonly keySlots: readonly bigint[];
    /** The raw account values (or null), in key order. */
    readonly values: readonly unknown[];
}
/**
 * Reads `keys` in getMultipleAccounts requests of at most eight keys, every page with the same `config` (encoding,
 * commitment, dataSlice and, when given, minContextSlot). The pages share one JSON-RPC batch where the transport batches
 * account reads and go one by one where it does not (the public mainnet endpoints). Every page must answer at or after
 * the configured minContextSlot; with `maxSlotSpread` set, the page slots may differ by at most that many slots, the
 * drift the caller already tolerates between its account snapshot and the reads that follow it. Keys that must agree
 * with each other (a pool and its tick arrays) go first, so they share the first page and its single slot.
 */
export declare function readSolanaAccountPages(rpc: SolanaRpcPort, keys: readonly string[], config: Readonly<Record<string, unknown>>, maxSlotSpread: bigint | null): Promise<SolanaAccountPagesRead>;
