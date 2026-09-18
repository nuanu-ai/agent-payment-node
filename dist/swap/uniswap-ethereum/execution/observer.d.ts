import type { Hex } from "viem";
import type { EvmRpcCall } from "../../../evm-ports.js";
import { type SwapOperationRecord, type SwapReceiptProof } from "../../model.js";
import type { UniswapExecutionBinding, UniswapReceiptObserverPort } from "./types.js";
/** A finalized outcome: success carries the full receipt proof; a revert carries its finalized status-0 proof. */
export type UniswapObservedOutcome = {
    readonly outcome: "succeeded" | "reverted";
    readonly proof: SwapReceiptProof;
};
export declare class UniswapEthereumReceiptObserver implements UniswapReceiptObserverPort {
    private readonly call;
    private readonly now;
    constructor(call: EvmRpcCall, now?: () => Date);
    observe(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, transactionHash: Hex): Promise<SwapReceiptProof | null>;
    observeOutcome(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, transactionHash: Hex): Promise<UniswapObservedOutcome | null>;
    /** Status 0 at a canonical finalized block with no logs proves the input never left; only gas was spent. */
    private revertProof;
    private balance;
    private assertChain;
    private assertTransactionEnvelope;
}
