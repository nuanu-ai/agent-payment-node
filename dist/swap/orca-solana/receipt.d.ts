import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type SwapOperationRecord, type SwapReceiptProof } from "../model.js";
import type { OrcaExecutionBinding } from "./effects.js";
import type { OrcaKeylessMaterial } from "./material.js";
export type OrcaObservedOutcome = {
    readonly outcome: "succeeded" | "reverted";
    readonly proof: SwapReceiptProof;
};
/**
 * Observe-only receipt reader. A finalized success must carry the exact signature and message, a fee within the
 * approved fee, a SOL spend within the approved maximum, and a USDC delta on the owner's account of at least the
 * minimum. A finalized failure proves every instruction reverted and only the fee was spent.
 */
export declare class OrcaReceiptObserver {
    private readonly rpc;
    private readonly now;
    constructor(rpc: SolanaRpcPort, now: () => Date);
    observeOutcome(operationValue: SwapOperationRecord, binding: OrcaExecutionBinding, material: OrcaKeylessMaterial, signature: string): Promise<OrcaObservedOutcome | null>;
}
