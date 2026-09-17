import { UNISWAP_NATIVE, UNISWAP_ROUTER, UNISWAP_USDC } from "./uniswap-pin.js";
export interface UniswapQuoteRequest {
    readonly type: "EXACT_INPUT";
    readonly amount: string;
    readonly tokenInChainId: 1;
    readonly tokenOutChainId: 1;
    readonly tokenIn: typeof UNISWAP_NATIVE;
    readonly tokenOut: typeof UNISWAP_USDC;
    readonly swapper: string;
    readonly recipient: string;
    readonly slippageTolerance: number;
    readonly protocols: readonly ["V2", "V3", "V4"];
    readonly routingPreference: "BEST_PRICE";
    readonly permitAmount: "EXACT";
    readonly generatePermitAsTransaction: false;
}
export interface UniswapClassicQuote {
    readonly chainId: 1;
    readonly input: {
        readonly token: typeof UNISWAP_NATIVE;
        readonly amount: string;
    };
    readonly output: {
        readonly token: typeof UNISWAP_USDC;
        readonly amount: string;
        readonly recipient: string;
    };
    readonly swapper: string;
    readonly tradeType: "EXACT_INPUT";
    readonly slippageTolerance: number;
    readonly route: readonly unknown[];
}
export interface UniswapQuoteResponse {
    readonly requestId: string;
    readonly routing: "CLASSIC";
    readonly quote: UniswapClassicQuote;
    readonly isTokenApprovalApplicable: false;
    readonly permitData: null;
}
export interface UniswapTransactionEnvelope {
    readonly from: string;
    readonly to: typeof UNISWAP_ROUTER;
    readonly data: `0x${string}`;
    readonly value: string;
    readonly gasLimit: string;
    readonly chainId: 1;
    readonly maxFeePerGas?: string;
    readonly maxPriorityFeePerGas?: string;
    readonly gasPrice?: string;
}
export interface UniswapSwapResponse {
    readonly requestId: string;
    readonly swap: UniswapTransactionEnvelope;
    readonly gasFee: string;
}
export declare function createUniswapQuoteRequest(input: {
    readonly amountAtomic: string;
    readonly swapper: string;
    readonly recipient: string;
    readonly slippageBps: number;
    readonly ownerSlippageCapBps: number;
}): UniswapQuoteRequest;
export declare function decodeUniswapQuoteResponse(value: unknown, request: UniswapQuoteRequest): UniswapQuoteResponse;
export declare function createUniswapSwapRequest(quote: UniswapClassicQuote, deadline: number): {
    quote: UniswapClassicQuote;
    simulateTransaction: false;
    safetyMode: "SAFE";
    deadline: number;
};
export declare function decodeUniswapSwapResponse(value: unknown, input: {
    readonly account: string;
    readonly amountAtomic: string;
    readonly maxGasLimit: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
}): UniswapSwapResponse;
export declare function uniswapRawDigest(value: unknown): string;
