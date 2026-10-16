import type { ReadOnlyRpcBatchCall } from "../rpc.js";
import { type Permit2ProductionMaterial } from "./production-material.js";
import type { Permit2DirectTransactionInput } from "./production-proxy-call.js";
import type { Permit2ReceiptInput } from "./production-receipt-facts.js";
export type Permit2ObservedBlock = ReturnType<typeof observerBlock>;
export declare function observerBlock(value: unknown, tag: string): Readonly<{
    tag: `0x${string}`;
    number: string;
    hash: `0x${string}`;
    timestamp: bigint;
}>;
export declare function assertObserverChain(value: unknown): void;
export declare function observerNonceCalls(material: Permit2ProductionMaterial, block: Permit2ObservedBlock): readonly ReadOnlyRpcBatchCall[];
/** Permit2 unordered nonces are single-use and APN signed one witness transfer with this nonce: a set bit is settlement. */
export declare function nonceConsumed(material: Permit2ProductionMaterial, value: unknown): boolean;
export declare function assertExpiredUnused(material: Permit2ProductionMaterial, block: Permit2ObservedBlock, values: readonly unknown[]): void;
/** Select the complete required raw RPC projection, preserving identity and indices before pure attribution. */
export declare function observerTransaction(value: unknown, locator: string): Permit2DirectTransactionInput;
export declare function observerReceipt(value: unknown, transaction: unknown): Permit2ReceiptInput;
