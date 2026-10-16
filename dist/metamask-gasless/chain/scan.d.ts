import type { Hex } from "../../model.js";
import type { MetaMaskGaslessBlock, MetaMaskGaslessCursor, MetaMaskGaslessDeploymentRow, MetaMaskGaslessIntent } from "../model.js";
import { type MetaMaskGaslessFailureReason } from "../reasons.js";
import { type MmRpcCall } from "./abi.js";
/** Widest log window asked for; narrower windows are only used after the RPC refuses one. */
export declare const MM_SCAN_WINDOW = 2000n;
/** Narrowest window worth asking for; a refusal at this width is reported, never narrowed further. */
export declare const MM_MIN_SCAN_WINDOW = 50n;
/** eth_getLogs requests one resume may spend, refused ones included. Unscanned blocks wait for the next resume. */
export declare const MM_MAX_LOG_QUERIES = 8;
/** Transport and log-limit reasons that keep the progress already proved in this resume. */
export declare const MM_SCAN_STOP_REASONS: readonly MetaMaskGaslessFailureReason[];
export interface MetaMaskScanContext {
    readonly row: MetaMaskGaslessDeploymentRow;
    readonly call: MmRpcCall;
}
export type MetaMaskScanResult = 
/** No redemption is possible up to `cursor`; the scan may still have unscanned blocks before finality. */
{
    readonly kind: "progress";
    readonly cursor: MetaMaskGaslessCursor;
    readonly evidenceHash: string;
}
/** The RPC stopped answering after `cursor`, which only covers fully verified blocks. */
 | {
    readonly kind: "stopped";
    readonly cursor: MetaMaskGaslessCursor;
    readonly reason: MetaMaskGaslessFailureReason;
}
/** Counter logs inside the window that starts at `cursor`; the caller inspects them and then rechecks `recheck`. */
 | {
    readonly kind: "found";
    readonly cursor: MetaMaskGaslessCursor;
    readonly candidates: readonly Hex[];
    readonly recheck: readonly MetaMaskGaslessBlock[];
    readonly evidenceHash: string;
};
/**
 * Locate a redemption of the delegation after the cursor, up to the registry finality block.
 *
 * Counter shortcut. `LimitedCallsEnforcer.callCounts(manager, delegationHash)` is written in exactly one place, its
 * `beforeHook`, as `++callCounts[msg.sender][delegationHash]` followed by a `limit` check and the `IncreasedCount`
 * event. The pinned DelegationManager calls that hook only inside `redeemDelegations`, after it has authenticated
 * the delegation whose hash it passes, so the slot keyed by the pinned manager and this exact delegation hash counts
 * this delegation's redemptions and nothing else; a call from anyone else lands in that caller's own slot. A
 * redemption that reverts anywhere, the transfers included, rolls the increment back with the rest of the
 * transaction. The count never decreases, and the prepare snapshot proved it was 0 at the frozen safe block that
 * starts the cursor. Read at a canonical block pinned by hash, against the pinned enforcer code, a count of 0 therefore
 * proves that no successful redemption exists in any block up to it, so the cursor may move there without a log
 * query. A reverted attempt leaves neither the increment nor its event, so the log scan never saw one either; a
 * revert is still only learnt from the provider's transaction hash. With limit 1 the count can only be 0 or 1.
 * Once it is 1, the bounded log scan finds the redeeming transaction for full inspection.
 */
export declare function scanMetaMaskRedemption(context: MetaMaskScanContext, intent: MetaMaskGaslessIntent, cursor: MetaMaskGaslessCursor): Promise<MetaMaskScanResult>;
/** `callCounts(manager, delegationHash)` at one canonical block pinned by hash, against the pinned enforcer code. */
export declare function mmRedemptionCount(context: MetaMaskScanContext, delegationHash: Hex, at: MetaMaskGaslessBlock): Promise<bigint>;
