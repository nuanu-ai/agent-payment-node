import { type Hex } from "viem";
import type { BridgeHttps } from "./https.js";
import type { OneClickLane } from "./near-oneclick-lanes.js";
import type { OneClickSourceRecord } from "./near-oneclick-source-journal.js";
/** Intrinsic gas of a plain value transfer to an account without code. */
export declare const ONECLICK_PLAIN_TRANSFER_GAS = 21000n;
export interface OneClickSourceCaps {
    readonly maxGas: bigint;
    readonly maxFee: bigint;
    readonly maxPriority: bigint;
    readonly maxNative: bigint;
}
export interface OneClickSourcePlan {
    readonly blockHash: Hex;
    readonly nonce: bigint;
    readonly gas: bigint;
    readonly fee: bigint;
    readonly tip: bigint;
    readonly nativeDebit: bigint;
    readonly depositCode: "eoa" | "contract" | null;
}
/** Raw hash-pinned Ethereum reads for a native deposit. Caps are applied once, by planOneClickNative. */
export interface OneClickNativeObservation {
    readonly blockHash: Hex;
    readonly nonce: bigint;
    readonly depositCode: "eoa" | "contract";
    readonly gas: bigint;
    readonly baseFee: bigint;
    readonly tip: bigint;
    readonly balance: bigint;
}
export declare function assertOneClickPostApproval(initial: Readonly<{
    nonce: bigint;
    gas: bigint;
    fee: bigint;
    tip: bigint;
}>, fresh: Readonly<{
    nonce: bigint;
    gas: bigint;
    fee: bigint;
    tip: bigint;
    nativeDebit: bigint;
}>, maxNativeDebit: bigint, effectiveDeadlineMs: number, nowMs: number): void;
/** Native debit is exactly value plus gas times the signed max fee; both must fit the owner's caps and the pinned balance. */
export declare function planOneClickNative(observed: OneClickNativeObservation, amount: bigint, caps: OneClickSourceCaps): OneClickSourcePlan;
/**
 * Ethereum base fee and tip suggestions move every block, while the signed envelope keeps the approved values.
 * After consent require the same nonce and deposit code class, no larger gas need, an approved max fee that still
 * covers the fresh base fee plus the approved tip, and a fresh pinned balance that still covers the exact approved debit.
 */
export declare function assertOneClickNativePostApproval(initial: OneClickSourcePlan, fresh: OneClickNativeObservation, amount: bigint, effectiveDeadlineMs: number, nowMs: number): void;
/** One lane's EVM origin through the existing bounded JSON-RPC reader; the URL comes only from the lane's env variable. */
export declare class OneClickEvmSource {
    private readonly lane;
    private readonly url;
    private readonly https;
    private readonly rpc;
    constructor(lane: OneClickLane, url: string, https: Pick<BridgeHttps, "request">);
    private chain;
    /** Base USDC: hash-pinned token, native, nonce, simulation and OP-stack fee reads (unchanged lane behaviour). */
    readToken(payer: string, data: Hex, amount: bigint, caps: OneClickSourceCaps, effectiveDeadlineMs: number, now: () => number): Promise<OneClickSourcePlan>;
    /** Ethereum ETH: balance and deposit code pinned to the safe block; the base fee reference is max(safe, latest). */
    observeNative(payer: string, deposit: string, amount: bigint): Promise<OneClickNativeObservation>;
    send(raw: Hex): Promise<Hex>;
    /** Safe-block receipt observation. It never implies destination delivery. */
    observe(record: OneClickSourceRecord): Promise<unknown>;
    /** Two reads outside the shared reader's method list, over the same validated endpoint and transport. */
    private raw;
}
