import type { SwapQuoteInput, SwapQuoteSnapshot } from "./quote.js";
import type { SwapOperationRecord, SwapReceiptProof } from "./model.js";

/** Implementations must return unsigned material only. */
export interface SwapProviderBuilderPort { build(input: SwapQuoteInput): Promise<SwapQuoteSnapshot> }
export interface SwapChainSimulatorPort { simulate(unsignedTransactionPayloadHash: string): Promise<{ readonly requestHash: string; readonly resultHash: string; readonly success: boolean }> }
/** Signed bytes stay inside the signer/sender boundary and are never journaled. */
export interface SwapChainSignerPort { sign(operation: SwapOperationRecord): Promise<{ readonly signedMaterialHandle: string }> }
export interface SwapChainSenderPort { sendOnce(signedMaterialHandle: string, submissionMarkerHash: string): Promise<{ readonly transactionHash: string }> }
/** Resume uses this port only after a persisted submission marker. */
export interface SwapChainObserverPort { observe(operation: SwapOperationRecord): Promise<SwapReceiptProof | null> }
