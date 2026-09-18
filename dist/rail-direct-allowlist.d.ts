import { type DirectAllowlistSubject, type DirectUsageTarget } from "./direct-allowlist-gate.js";
import type { ChainAccount, ChainAsset, DirectRailName, RailPreparedTransfer } from "./direct-rail-ports.js";
import type { RailState } from "./rail-operation-model.js";
/** The transitions at which a rail crosses into signing or a provider send; the usage lease is written with the first one. */
export declare const RAIL_LEASE_STATES: readonly RailState[];
export declare function railAllowlistChain(rail: DirectRailName): string;
/** The TRON and Solana aliases are resolved against the frozen list before any account, RPC or custody call. */
export declare function requireListedRailAsset(asset: ChainAsset): void;
export declare function railAllowlistSubject(input: {
    readonly profile: string;
    readonly operationId: string;
    readonly account: ChainAccount;
    readonly prepared: Pick<RailPreparedTransfer, "asset" | "amountAtomic">;
}): DirectAllowlistSubject;
/** Optional on records written before the gate; once bound, the lease is mandatory from the first signing or send transition. */
export declare function validateRailAllowlist(value: Record<string, unknown>, subject: DirectAllowlistSubject): void;
/** Signed bytes that were never sent stay reserved (they may still fail before effect); a send is charged until proven. */
export declare function railUsageTarget(state: RailState): DirectUsageTarget;
