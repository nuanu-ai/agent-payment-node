import { type MetaMaskGaslessQuote } from "../model.js";
import type { ModeContext } from "./network.js";
import type { NativeGasFacts, ReadValidationPredicate, SentinelFeeFacts, TokenFeesKind } from "./read-diagnostic.js";
/** Closed facts of one classified Sentinel validation failure, read only from the very error it threw. */
export interface SentinelFailure {
    readonly validationPredicate: ReadValidationPredicate;
    readonly tokenFeesShape?: TokenFeesKind;
    readonly feeFacts?: SentinelFeeFacts & Partial<NativeGasFacts>;
}
export declare function sentinelFailure(error: unknown): SentinelFailure | undefined;
/** The one matching token-fee entry of an answer `validateSentinelResponse` already accepted, in USDC atoms. */
export declare function sentinelQuotedFee(value: Record<string, unknown>, token: string): bigint;
export declare function parseSentinelResponse(body: string): Record<string, unknown>;
export declare function validateSentinelResponse(value: Record<string, unknown>, context: ModeContext): void;
/** Parse only a successful principal simulation from the already validated original request. */
export declare function captureSponsoredQuote(body: string, request: string, context: Extract<ModeContext, {
    mode: "quote";
}>): MetaMaskGaslessQuote | undefined;
