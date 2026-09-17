export interface JupiterRouteLeg {
    readonly percent: number;
    readonly swapInfo: {
        readonly ammKey: string;
        readonly label: string;
        readonly inputMint: string;
        readonly outputMint: string;
        readonly inAmount: string;
        readonly outAmount: string;
        readonly feeAmount: string;
        readonly feeMint: string;
    };
}
export interface JupiterQuoteResponse {
    readonly inputMint: string;
    readonly inAmount: string;
    readonly outputMint: string;
    readonly outAmount: string;
    readonly otherAmountThreshold: string;
    readonly swapMode: "ExactIn";
    readonly slippageBps: number;
    readonly priceImpactPct: string;
    readonly routePlan: readonly JupiterRouteLeg[];
    readonly contextSlot: number;
    readonly timeTaken: number;
    readonly responseHash: string;
}
export interface JupiterOrderResponse {
    readonly requestId: string;
    readonly transaction: string;
    readonly lastValidBlockHeight: string;
    readonly rfqExpiresAt: string | null;
    readonly quote: JupiterQuoteResponse;
    readonly responseHash: string;
}
export interface JupiterBuildResponse {
    readonly requestId: string;
    readonly swapTransaction: string;
    readonly lastValidBlockHeight: string;
    readonly rfqExpiresAt: string | null;
    readonly prioritizationFeeLamports: string;
    readonly tipLamports: string;
    readonly rentFeeLamports: string;
    readonly platformFeeAtomic: string;
    readonly referralFeeAtomic: string;
    readonly responseHash: string;
}
export declare function decodeQuoteResponse(value: unknown): JupiterQuoteResponse;
export declare function decodeOrderResponse(value: unknown): JupiterOrderResponse;
export declare function decodeBuildResponse(value: unknown): JupiterBuildResponse;
