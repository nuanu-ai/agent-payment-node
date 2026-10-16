import { ApnError } from "../errors.js";
import { protocolFailure, rpcArray, rpcAtomic, rpcRecord, solanaReadBatch, type SolanaBatchRead, type SolanaRpcPort } from "../solana/rpc.js";

/** PublicNode, the strictest keyless public endpoint, answers at most eight keys per getMultipleAccounts. */
export const SOLANA_ACCOUNT_KEYS_PER_READ = 8;
/** The transport carries at most eight reads in one JSON-RPC array. */
const READS_PER_BATCH = 8;

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
export async function readSolanaAccountPages(rpc: SolanaRpcPort, keys: readonly string[], config: Readonly<Record<string, unknown>>,
  maxSlotSpread: bigint | null): Promise<SolanaAccountPagesRead> {
  if (keys.length < 1 || new Set(keys).size !== keys.length) protocolFailure();
  const pages: string[][] = [];
  for (let offset = 0; offset < keys.length; offset += SOLANA_ACCOUNT_KEYS_PER_READ) pages.push(keys.slice(offset, offset + SOLANA_ACCOUNT_KEYS_PER_READ));
  const responses: unknown[] = [];
  for (let offset = 0; offset < pages.length; offset += READS_PER_BATCH) {
    const reads: SolanaBatchRead[] = pages.slice(offset, offset + READS_PER_BATCH).map((page) => ({ method: "getMultipleAccounts", params: [page, config] }));
    const results = reads.length === 1 ? [await rpc.call(reads[0]!.method, reads[0]!.params)] : await solanaReadBatch(rpc, reads);
    if (!Array.isArray(results) || results.length !== reads.length) throw new ApnError("APN_RPC_PROTOCOL", "Solana account read batch is incomplete.");
    responses.push(...results);
  }
  const minimum = config.minContextSlot === undefined ? null : rpcAtomic(config.minContextSlot);
  const keySlots: bigint[] = [], values: unknown[] = [], pageSlots: bigint[] = [];
  for (const [index, page] of pages.entries()) {
    const response = rpcRecord(responses[index]), slot = rpcAtomic(rpcRecord(response.context).slot), value = rpcArray(response.value, page.length);
    if (value.length !== page.length) protocolFailure();
    if (minimum !== null && slot < minimum) throw new ApnError("APN_RPC_PROTOCOL", "A Solana account page answered behind its minimum context slot.");
    pageSlots.push(slot); keySlots.push(...page.map(() => slot)); values.push(...value);
  }
  const low = pageSlots.reduce((a, b) => a < b ? a : b), high = pageSlots.reduce((a, b) => a > b ? a : b);
  if (maxSlotSpread !== null && high - low > maxSlotSpread) {
    throw new ApnError("APN_OPERATION_BLOCKED", "The RPC answered the account pages too far apart to form one snapshot; nothing was signed, try again.",
      { reason: "solana_account_pages_slot_spread", lowestSlot: low.toString(), highestSlot: high.toString(), maxSlotSpread: maxSlotSpread.toString() });
  }
  return { slot: high, keySlots, values };
}
