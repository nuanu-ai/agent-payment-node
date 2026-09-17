import { type SwapQuoteSnapshot, type SwapSimulationProof } from "../quote.js";
export interface SunSwapQuoteRoute {
    readonly inputAmountAtomic: string;
    readonly roadForAddr: readonly string[];
    readonly roadForName: readonly string[];
    readonly pool: readonly string[];
    readonly amount: string;
    readonly amountOutAtomic: string;
    readonly inUsd: string;
    readonly outUsd: string;
    readonly impact: string;
    readonly fee: string;
    readonly routeHash: string;
}
export interface SunSwapQuoteRequest {
    readonly inputAmountAtomic: string;
}
export interface SunSwapQuoteSnapshotInput {
    readonly profile: string;
    readonly account: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly slippageBps: number;
    readonly effectiveAt: string;
    readonly expiresAt: string;
    readonly providerResponseHash: string;
    readonly unsignedTransactionPayloadHash: string;
    readonly route: SunSwapQuoteRoute;
    readonly simulation: SwapSimulationProof;
}
export declare function sunSwapQuoteUrl(input: SunSwapQuoteRequest): URL;
export declare function decodeSunSwapQuote(value: unknown, inputAmountAtomic: string): readonly SunSwapQuoteRoute[];
export declare function validateSunSwapQuoteRoute(value: unknown): SunSwapQuoteRoute;
export declare function assertSunSwapDirectRoute(value: unknown, minimumOutputAtomic: string): SunSwapQuoteRoute;
export declare function createSunSwapQuoteSnapshot(input: SunSwapQuoteSnapshotInput): SwapQuoteSnapshot;
export declare class SunSwapQuoteAdapter {
    private readonly fetcher;
    constructor(fetcher?: typeof fetch);
    quote(input: SunSwapQuoteRequest): Promise<readonly SunSwapQuoteRoute[]>;
}
