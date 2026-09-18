import { type SwapOperationRecord, type SwapReceiptProof } from "../model.js";
import type { SunSwapObservationRpcPort } from "./observer.js";
import { type SunSwapPreparedMaterial } from "./prepared.js";
import { type SunSwapReceiptExpectation } from "./receipt.js";
export type SunSwapObservedOutcome = {
    readonly outcome: "succeeded" | "reverted";
    readonly proof: SwapReceiptProof;
};
/**
 * Observe-only outcome reader for the exact prepared transaction. Null means not yet solidified. Success needs the
 * full receipt proof; a failed contract result needs the same transaction bytes, fee bounds and no emitted logs, from
 * both full-node and solidified history.
 */
export declare class SunSwapOutcomeObserver {
    private readonly rpc;
    private readonly now;
    constructor(rpc: SunSwapObservationRpcPort, now: () => Date);
    observeOutcome(operationValue: SwapOperationRecord, materialValue: SunSwapPreparedMaterial): Promise<SunSwapObservedOutcome | null>;
}
/** A solidified failed call: exact bytes, one failed result on both records, fees within the frozen bounds, no logs. */
export declare function validateSunSwapFailure(transactionValue: unknown, infoValue: unknown, solidifiedHeadNumber: string, expected: SunSwapReceiptExpectation): {
    readonly receiptHash: string;
};
