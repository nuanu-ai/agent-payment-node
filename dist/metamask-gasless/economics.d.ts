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
/**
 * The owner approves a maximum, not one exact price. A quote taken after that approval is admissible when its fee
 * stays inside the effective cap, the recipient still clears the floor and the gross still splits exactly.
 */
export declare function mmRepriceWithinCap(value: unknown, request: MetaMaskGaslessRequest, binding: MetaMaskGaslessBinding, reason?: MetaMaskGaslessFailureReason): MetaMaskGaslessQuote;
export declare function mmPolicyHash(profileHash: string, binding: MetaMaskGaslessBinding, request: MetaMaskGaslessRequest): string;
export declare function mmAssertIntentEconomics(intent: MetaMaskGaslessIntent, profileHash: string): void;
