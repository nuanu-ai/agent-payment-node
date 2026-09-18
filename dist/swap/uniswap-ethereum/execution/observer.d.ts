import type { Hex } from "viem";
import type { EvmRpcCall } from "../../../evm-ports.js";
import { type SwapOperationRecord, type SwapReceiptProof } from "../../model.js";
import { type UniswapBalanceEvidencePort } from "./evidence-store.js";
import type { UniswapExecutionBinding, UniswapReceiptObserverPort } from "./types.js";
/** A finalized outcome: success carries the full receipt proof; a revert carries its finalized status-0 proof. */
export type UniswapObservedOutcome = {
    readonly outcome: "succeeded" | "reverted";
    readonly proof: SwapReceiptProof;
};
export declare class UniswapEthereumReceiptObserver implements UniswapReceiptObserverPort {
    private readonly call;
    private readonly now;
    private readonly evidence?;
    /** Without an evidence store every observation reads the balances around the swap block again. */
    constructor(call: EvmRpcCall, now?: () => Date, evidence?: UniswapBalanceEvidencePort | undefined);
    observe(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, transactionHash: Hex): Promise<SwapReceiptProof | null>;
    observeOutcome(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, transactionHash: Hex): Promise<UniswapObservedOutcome | null>;
    /** Status 0 at a canonical finalized block with no logs proves the input never left; only gas was spent. */
    private revertProof;
    /** Balance evidence for this exact canonical block: kept from first sight, or read now and kept. */
    private balanceEvidence;
    private balance;
    private assertChain;
    private assertTransactionEnvelope;
}
