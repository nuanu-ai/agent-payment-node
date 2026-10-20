import { type SwapOperationRecord, type SwapReceiptEconomics, type SwapReceiptProof } from "../model.js";
import { type SunSwapPreparedMaterial } from "./prepared.js";
import { type SunSwapReceiptExpectation, type SunSwapReceiptValidation } from "./receipt.js";
import { type SwapUnlandedProof } from "../unlanded.js";
export type SunSwapObservationMethod = "wallet/gettransactionbyid" | "wallet/gettransactioninfobyid" | "walletsolidity/gettransactionbyid" | "walletsolidity/gettransactioninfobyid" | "walletsolidity/getnowblock";
export interface SunSwapObservationRpcPort {
    call(method: SunSwapObservationMethod, body: Readonly<Record<string, unknown>>): Promise<unknown>;
}
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
    /** One read of a swap its record proved solidified: the solidified transaction, its info and the head (observe only). */
    receiptEconomics(operationValue: SwapOperationRecord, materialValue: SunSwapPreparedMaterial): Promise<SwapReceiptEconomics>;
    /** Expiration passed at the solidified head and no solidified record of the exact transaction id. */
    proveUnlanded(materialValue: SunSwapPreparedMaterial): Promise<SwapUnlandedProof | null>;
}
/** The economics of a solidified record already proven as this outcome, by the same validators that finalized it. */
export declare function sunSwapEconomicsFromSolidified(state: string, transaction: unknown, info: unknown, solidifiedHeadNumber: string, expected: SunSwapReceiptExpectation): SwapReceiptEconomics;
/** A solidified failed call: exact bytes, one failed result on both records, fees within the frozen bounds, no logs. */
export declare function validateSunSwapFailure(transactionValue: unknown, infoValue: unknown, solidifiedHeadNumber: string, expected: SunSwapReceiptExpectation): Pick<SunSwapReceiptValidation, "receiptHash" | "inputAmountAtomic" | "feeSun" | "trxDebitSun"> & {
    readonly outputAmountAtomic: null;
};
