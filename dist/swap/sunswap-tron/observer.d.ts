import type { SwapChainObserverPort } from "../ports.js";
import { type SwapOperationRecord, type SwapReceiptProof } from "../model.js";
import { type SunSwapExecutionBinding } from "./signer.js";
import { type SunSwapReceiptExpectation, type SunSwapReceiptValidation } from "./receipt.js";
export type SunSwapObservationMethod = "wallet/gettransactionbyid" | "wallet/gettransactioninfobyid" | "walletsolidity/gettransactionbyid" | "walletsolidity/gettransactioninfobyid" | "walletsolidity/getnowblock";
export interface SunSwapObservationRpcPort {
    call(method: SunSwapObservationMethod, body: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export declare class SunSwapSolidifiedObserver implements SwapChainObserverPort {
    private readonly rpc;
    private readonly expectedOperation;
    private readonly binding;
    private readonly maximumFeeSun;
    private readonly now;
    constructor(rpc: SunSwapObservationRpcPort, expectedOperation: SwapOperationRecord, binding: SunSwapExecutionBinding, maximumFeeSun: string, now?: () => Date);
    observe(operationValue: SwapOperationRecord): Promise<SwapReceiptProof | null>;
}
export declare function observeSunSwapFinality(rpc: SunSwapObservationRpcPort, expected: SunSwapReceiptExpectation): Promise<SunSwapReceiptValidation>;
