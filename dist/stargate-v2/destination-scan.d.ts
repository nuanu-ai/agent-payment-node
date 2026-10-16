import type { Hex } from "viem";
import type { Address } from "../model.js";
import { SecureStateStore } from "../secure-state-store.js";
/** Public Polygon providers used by the live recovery rejected 261-block log ranges despite advertising a larger limit. */
export declare const STARGATE_POLYGON_SCAN_WINDOW = 100n;
/** mainnet.unichain.org and unichain-rpc.publicnode.com answered 2,000-block filtered ranges on 2026-10-16. */
export declare const STARGATE_UNICHAIN_SCAN_WINDOW = 1000n;
/** Windows one observe may scan; a later observe resumes from the saved cursor, so a late delivery never dead-ends. */
export declare const STARGATE_SCAN_WINDOWS_PER_CALL = 32;
export interface StargateScanCursor {
    load(): Promise<bigint | null>;
    save(nextBlock: bigint): Promise<void>;
}
type Call = (method: string, params: readonly unknown[]) => Promise<unknown>;
/** Durable progress of one operation's destination scan. It only ever records the first block not yet scanned, and only
 * after every earlier window up to the finality head returned no matching log, so resuming from it cannot skip a delivery. */
export declare class StargateDestinationScanStore extends SecureStateStore {
    cursor(operationId: string, scope: "token-oft" | "native-oft"): StargateScanCursor;
}
/**
 * Filtered `eth_getLogs` in bounded windows from `max(from, cursor)` up to the finality head `to` (BRDG-30). Returns the
 * first window's logs that match the indexed filter (the caller validates them), or none after at most `maxWindows`
 * windows; the cursor then advances to the first block not yet scanned. A filter by GUID and recipient topics returns
 * at most the one delivery instead of every pool event.
 */
export declare function scanStargateLogs(call: Call, filter: Readonly<{
    address: Address | readonly Address[];
    topics: readonly (Hex | readonly Hex[] | null)[];
}>, from: bigint, to: bigint, window: bigint, cursor?: StargateScanCursor, maxWindows?: number): Promise<Record<string, unknown>[]>;
export {};
