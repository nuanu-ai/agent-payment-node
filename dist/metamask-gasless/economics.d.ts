import type { MetaMaskGaslessBinding, MetaMaskGaslessIntent, MetaMaskGaslessQuote, MetaMaskGaslessQuoteMaterial, MetaMaskGaslessRequest } from "./model.js";
import { type MetaMaskGaslessFailureReason } from "./reasons.js";
export declare function mmEconomics(request: MetaMaskGaslessRequest): {
    gross: bigint;
    cap: bigint;
    initialNet: bigint;
};
export declare function mmQuoteHash(quote: MetaMaskGaslessQuoteMaterial): string;
/** Validate each quote independently; convergence and final G=N+F are separate checks. */
export declare function mmQuote(value: unknown, request: MetaMaskGaslessRequest, binding: MetaMaskGaslessBinding, requestedNet: string, reason?: MetaMaskGaslessFailureReason): MetaMaskGaslessQuote;
export declare function mmAssertStableQuote(request: MetaMaskGaslessRequest, quote: MetaMaskGaslessQuote, reason?: MetaMaskGaslessFailureReason): void;
export declare function mmPolicyHash(profileHash: string, binding: MetaMaskGaslessBinding, request: MetaMaskGaslessRequest): string;
export declare function mmAssertIntentEconomics(intent: MetaMaskGaslessIntent, profileHash: string): void;
