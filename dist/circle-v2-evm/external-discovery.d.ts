/** Finds the destination transaction that consumed one CCTP V2 issuer message from block headers and MessageTransmitter
 * logs only: no state is read at any block (P1). The result is a hint; external adoption proves it from the canonical
 * receipt at the destination SAFE head. */
import { type Hex } from "viem";
import type { CircleRpc } from "./rpc.js";
/** Read plan of one discovery (P4): chain identity, the latest head, at most `locate` headers to find the block stamped at
 * the burn time, and at most `logs` transmitter log windows of the route's `logRange` blocks. Every read may be retried
 * once after a transient HTTP failure, so the discovery client's budget is twice the plan. */
export declare const CIRCLE_DISCOVERY_READ_PLAN: {
    readonly identity: 1;
    readonly head: 1;
    readonly locate: 32;
    readonly logs: 64;
};
export declare const CIRCLE_DISCOVERY_REQUEST_BUDGET: number;
/** Each chain stamps blocks with its own clock: the scan starts this many seconds before the burn's source timestamp. */
export declare const CIRCLE_DISCOVERY_CLOCK_MARGIN_S = 60n;
export type CircleDiscoveryRpc = Pick<CircleRpc, "chainId" | "identity" | "block" | "call">;
export interface CircleExternalMintScan {
    readonly transactionHash: Hex | null;
    readonly fromBlock: bigint;
    readonly toBlock: bigint;
    readonly headBlock: bigint;
    readonly headerReads: number;
    readonly logReads: number;
}
/** Scans forward from the block stamped at the burn time (less the clock margin) to the latest head, one `logRange`
 * window per request, for the MessageReceived log carrying this nonce, and stops at the first window that has it or
 * after `logs` windows. `transactionHash` is null when the scan ended without it. */
export declare function discoverCircleExternalMint(rpc: CircleDiscoveryRpc, nonce: Hex, burnTimestamp: bigint): Promise<CircleExternalMintScan>;
