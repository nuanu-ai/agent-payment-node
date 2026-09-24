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
/** The separate, unassembled GET /swap/v2/build wire shape. It grants no signing authority. */
export interface JupiterRawInstruction {
    readonly programId: string;
    readonly accounts: readonly {
        readonly pubkey: string;
        readonly isWritable: boolean;
        readonly isSigner: boolean;
    }[];
    readonly data: string;
}
export interface JupiterRawRouteStep {
    readonly percent: number;
    readonly bps: number;
    readonly usdValue?: number;
    readonly swapInfo: {
        readonly ammKey: string;
        readonly label: string;
        readonly inputMint: string;
        readonly outputMint: string;
        readonly inAmount: string;
        readonly outAmount: string;
    };
}
export interface JupiterRawBuildResponse {
    readonly inputMint: string;
    readonly outputMint: string;
    readonly inAmount: string;
    readonly outAmount: string;
    readonly otherAmountThreshold: string;
    readonly swapMode: string;
    readonly slippageBps: number;
    readonly priceImpactPct?: string;
    readonly routePlan: readonly JupiterRawRouteStep[];
    readonly computeBudgetInstructions: readonly JupiterRawInstruction[];
    readonly setupInstructions: readonly JupiterRawInstruction[];
    readonly swapInstruction: JupiterRawInstruction;
    readonly cleanupInstruction: JupiterRawInstruction | null;
    readonly otherInstructions: readonly JupiterRawInstruction[];
    readonly tipInstruction: JupiterRawInstruction | null;
    readonly addressesByLookupTableAddress: Readonly<Record<string, readonly string[]>> | null;
    readonly blockhashWithMetadata: {
        readonly blockhash: readonly number[];
        readonly lastValidBlockHeight: number;
        readonly fetchedAt?: {
            readonly secs_since_epoch: number;
            readonly nanos_since_epoch: number;
        };
    };
    readonly responseHash: string;
}
export declare function decodeQuoteResponse(value: unknown): JupiterQuoteResponse;
export declare function decodeOrderResponse(value: unknown): JupiterOrderResponse;
export declare function decodeBuildResponse(value: unknown): JupiterBuildResponse;
export declare function decodeRawBuildResponse(value: unknown): JupiterRawBuildResponse;
