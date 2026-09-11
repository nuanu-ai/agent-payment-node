import type { MetaMaskGaslessBinding, MetaMaskGaslessIntent, MetaMaskGaslessProfileIdentity, MetaMaskGaslessProviderObservation, MetaMaskGaslessQuote, MetaMaskGaslessUnsignedResult } from "../model.js";
import type { MetaMaskGaslessQuoteInput, MetaMaskGaslessUnsignedInput } from "../ports.js";
import { type MetaMaskGaslessFailure } from "../reasons.js";
export declare const MM_HELPER_VERSION: "apn.metamask-gasless-helper.v1";
export type HelperMode = "inspect" | "quote" | "buildUnsigned" | "submit" | "observe";
export type HelperRequest = {
    readonly version: typeof MM_HELPER_VERSION;
    readonly mode: "inspect";
    readonly expected: MetaMaskGaslessProfileIdentity;
} | {
    readonly version: typeof MM_HELPER_VERSION;
    readonly mode: "quote";
    readonly input: MetaMaskGaslessQuoteInput;
} | {
    readonly version: typeof MM_HELPER_VERSION;
    readonly mode: "buildUnsigned";
    readonly input: MetaMaskGaslessUnsignedInput;
} | {
    readonly version: typeof MM_HELPER_VERSION;
    readonly mode: "submit" | "observe";
    readonly intent: MetaMaskGaslessIntent;
};
export type HelperResult = MetaMaskGaslessBinding | MetaMaskGaslessQuote | MetaMaskGaslessUnsignedResult | MetaMaskGaslessProviderObservation;
export type HelperResponse = {
    readonly version: typeof MM_HELPER_VERSION;
    readonly ok: true;
    readonly result: HelperResult;
} | {
    readonly version: typeof MM_HELPER_VERSION;
    readonly ok: false;
    readonly failure: MetaMaskGaslessFailure;
};
export declare function helperRequest(value: unknown): HelperRequest;
export declare function helperResponse(value: unknown, request: HelperRequest): HelperResponse;
