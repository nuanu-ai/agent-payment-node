import type { ReadOnlyRpcBatchCall } from "../rpc.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
import { type Permit2ObservedBlock } from "./production-observer-facts.js";
/**
 * One batch pinned to the finalized block: payer code, the Permit2 nonce word, balance, allowance and (sponsored) the
 * EIP-2612 nonce. The proxy and Permit2 runtime codes and the token domain were proven at prepare and are not re-read:
 * both contracts are immutable at fixed addresses, and the signature binds the frozen domain.
 */
export declare function signingCalls(record: Permit2ProductionRecord, block: Permit2ObservedBlock): readonly ReadOnlyRpcBatchCall[];
export declare function assertSigningReads(record: Permit2ProductionRecord, values: readonly unknown[]): void;
export declare function assertSigningTime(record: Permit2ProductionRecord, now: Date, block?: Permit2ObservedBlock): void;
