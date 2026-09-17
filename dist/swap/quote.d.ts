import { type CandidateKind } from "../allowlist-inventory.js";
export declare const SWAP_QUOTE_SCHEMA: "apn.swap-quote.v1";
export interface SwapAssetIdentity {
    readonly chain: string;
    readonly kind: CandidateKind;
    readonly identifier: string | null;
}
export interface SwapSimulationProof {
    readonly requestHash: string;
    readonly resultHash: string;
    readonly success: true;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly headBlockNumber: string;
    readonly maxHeadDrift: number;
    readonly gasEstimate: string;
}
export interface SwapQuoteSnapshot {
    readonly schemaVersion: typeof SWAP_QUOTE_SCHEMA;
    readonly profile: string;
    readonly profileHash: string;
    readonly account: string;
    readonly recipient: string;
    readonly sourceAsset: SwapAssetIdentity;
    readonly destinationAsset: SwapAssetIdentity;
    readonly inputAmountAtomic: string;
    readonly expectedOutputAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly slippageBps: number;
    readonly effectiveAt: string;
    readonly expiresAt: string;
    readonly providerResponseHash: string;
    readonly routeHash: string;
    readonly unsignedTransactionPayloadHash: string;
    readonly simulation: SwapSimulationProof;
    readonly quoteHash: string;
}
export type SwapQuoteInput = Omit<SwapQuoteSnapshot, "schemaVersion" | "profileHash" | "quoteHash">;
export declare function createSwapQuote(input: SwapQuoteInput): SwapQuoteSnapshot;
export declare function validateSwapQuote(value: unknown, mode?: "input" | "stored"): SwapQuoteSnapshot;
