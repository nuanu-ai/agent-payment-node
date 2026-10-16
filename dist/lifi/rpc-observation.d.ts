import type { EvmRpcCall } from "../evm-ports.js";
import type { Hex } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock, BridgeDestinationTransactionProof, BridgeEnvelope, BridgeProtocolReceipt, BridgeTransactionProof } from "./model.js";
import type { BridgeObservationOptions, BridgeRpcPort } from "./ports.js";
import { bridgeActualFees, type legacyBridgeActualFees } from "./rpc-fees.js";
import type { RpcBatchReadItem } from "./rpc-session.js";
type PlannedRead = Omit<RpcBatchReadItem, "batchAttempt">;
export type BridgeBatchCall = (items: readonly PlannedRead[], route?: "primary" | "archive" | "archive_deployment" | "receipt") => Promise<readonly unknown[]>;
type NativeDelivery = Parameters<BridgeRpcPort["observe"]>[2];
type Fees = ReturnType<typeof bridgeActualFees> | Awaited<ReturnType<typeof legacyBridgeActualFees>>;
export interface BridgeObservationContext {
    readonly chainId: BridgeChainId;
    readonly origin: string;
    /** Single reads; the transport sends pinned history and traces to an owner-named archive, receipts to a named reader. */
    readonly call: EvmRpcCall;
    readonly batchCall: BridgeBatchCall;
    readonly receipts: Readonly<{
        reader: boolean;
        fallback: boolean;
    }>;
    /** Only the frozen historical migration proofs re-prove Base fees through the legacy pinned oracle. */
    readonly legacyFees?: (receipt: Readonly<Record<string, unknown>>, block: BridgeBlock, safe: BridgeBlock) => Promise<Fees>;
}
/**
 * Clean POSTs of one canonical observation, in the order `observeCanonical` sends them: the batch of transaction, receipt,
 * safe head and (when already known) the inclusion header; the inclusion header when it was not known; and the receipt
 * route's own reads, at most two (a one-item reader's chain identity and receipt, or an empty primary receipt's fallback).
 */
export declare const BRIDGE_CANONICAL_OBSERVATION_POSTS: number;
/** A provider-bound native delivery adds the pre-delivery header, the archive chain identity, two pinned balances and the trace. */
export declare const BRIDGE_NATIVE_DELIVERY_POSTS = 5;
/**
 * One transaction's canonical inclusion: the receipt binds the transaction at its index, the inclusion header's hash
 * equals the receipt's block hash and lists the transaction there, and the safe head decides finality. Every read is
 * one batch on the primary endpoint; hash-pinned reads need no header recheck because the node enforces canonicality.
 * Fees come from the receipt (Base: `l1Fee` and the operator fee fields), never from historical oracle state.
 */
export declare function observeCanonical(c: BridgeObservationContext, hash: Hex, expected: BridgeEnvelope | undefined, nativeDelivery: NativeDelivery, includeFees: boolean, options?: BridgeObservationOptions): Promise<{
    transaction: BridgeTransactionProof | BridgeDestinationTransactionProof;
    receipt: BridgeProtocolReceipt;
} | null>;
export {};
