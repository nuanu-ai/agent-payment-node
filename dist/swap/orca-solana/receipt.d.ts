import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type SwapOperationRecord, type SwapReceiptEconomics, type SwapReceiptProof } from "../model.js";
import { type SwapUnlandedProof } from "../unlanded.js";
import type { OrcaExecutionBinding } from "./effects.js";
import type { OrcaKeylessMaterial } from "./material.js";
export type OrcaObservedOutcome = {
    readonly outcome: "succeeded" | "reverted";
    readonly proof: SwapReceiptProof;
};
/**
 * Observe-only receipt reader. A finalized success must carry the exact signature and message, a fee within the
 * approved fee, a SOL spend within the approved maximum, and a delta of the pool's output token on the owner's
 * destination account of at least the minimum; for a token-input pool the owner's source account must also have lost
 * exactly the input. A finalized failure proves every instruction reverted and only the fee was spent.
 */
export declare class OrcaReceiptObserver {
    private readonly rpc;
    private readonly now;
    constructor(rpc: SolanaRpcPort, now: () => Date);
    /** Finalized height past the bound lifetime and no status for the persisted signature: it can never land. */
    proveUnlanded(lastValidBlockHeight: string, loadSignature: () => Promise<string | null>): Promise<SwapUnlandedProof | null>;
    /** One read of a swap its record proved finalized: its own finalized transaction, for the economics (observe only). */
    receiptEconomics(operationValue: SwapOperationRecord, material: OrcaKeylessMaterial): Promise<SwapReceiptEconomics>;
    observeOutcome(operationValue: SwapOperationRecord, binding: OrcaExecutionBinding, material: OrcaKeylessMaterial, signature: string): Promise<OrcaObservedOutcome | null>;
}
export { tokenBalance as orcaTokenBalance };
declare function tokenBalance(value: unknown, index: number, mint: string, decimals: number, owner: string, allowMissing: boolean): bigint;
