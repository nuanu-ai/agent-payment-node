import { type MetaMaskReadDiagnostic } from "./read-diagnostic.js";
import { type MetaMaskSubmitDiagnostic } from "./submit-diagnostic.js";
import { type MetaMaskObserveDiagnostic } from "./observe-diagnostic.js";
import { type MetaMaskServerRequestQuery, type MetaMaskServerRequestRead } from "./server-request.js";
import { type MetaMaskServerTransactionAnswer, type MetaMaskServerTransactionInput } from "./server-transaction.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessProviderIntent, MetaMaskGaslessProfileIdentity, MetaMaskGaslessProviderObservation, MetaMaskGaslessQuote, MetaMaskGaslessUnsignedResult } from "../model.js";
import type { MetaMaskGaslessQuoteInput, MetaMaskGaslessUnsignedInput } from "../ports.js";
import { type MetaMaskGaslessFailure } from "../reasons.js";
export declare const MM_HELPER_VERSION: "apn.metamask-gasless-helper.v1";
export type HelperMode = "inspect" | "quote" | "buildUnsigned" | "submit" | "observe" | "readRequest" | "submitTransaction";
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
    readonly intent: MetaMaskGaslessProviderIntent;
}
/** A native transfer's server-wallet request, read by its exact id (client/server-request.ts). */
 | {
    readonly version: typeof MM_HELPER_VERSION;
    readonly mode: "readRequest";
    readonly query: MetaMaskServerRequestQuery;
}
/** A native transfer's or revoke's server-wallet transaction request, with APN's own id (client/server-transaction.ts). */
 | {
    readonly version: typeof MM_HELPER_VERSION;
    readonly mode: "submitTransaction";
    readonly transaction: MetaMaskServerTransactionInput;
};
export type HelperResult = MetaMaskGaslessBinding | MetaMaskGaslessQuote | MetaMaskGaslessUnsignedResult | MetaMaskGaslessProviderObservation | MetaMaskServerRequestRead | MetaMaskServerTransactionAnswer;
export type HelperResponse = {
    readonly version: typeof MM_HELPER_VERSION;
    readonly ok: true;
    readonly result: HelperResult;
} | {
    readonly version: typeof MM_HELPER_VERSION;
    readonly ok: false;
    readonly failure: MetaMaskGaslessFailure;
    readonly diagnostic?: MetaMaskReadDiagnostic;
    readonly submitDiagnostic?: MetaMaskSubmitDiagnostic;
    readonly observeDiagnostic?: MetaMaskObserveDiagnostic;
};
export declare function helperRequest(value: unknown): HelperRequest;
export declare function helperResponse(value: unknown, request: HelperRequest): HelperResponse;
/** The modes whose one POST may create a provider request: any failure of theirs leaves the request's outcome unknown. */
export declare function helperSends(mode: HelperMode): mode is "submit" | "submitTransaction";
