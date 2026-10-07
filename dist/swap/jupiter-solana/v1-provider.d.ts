import { type JupiterV1QuoteResponse, type JupiterV1RawBuildResponse } from "./v1-codec.js";
export interface JupiterV1ExactInRequest {
    readonly inputMint: string;
    readonly outputMint: string;
    readonly amount: string;
    readonly taker: string;
    readonly recipient: string;
    readonly slippageBps: number;
    readonly computeUnitPriceMicroLamports: number;
}
/** Only official V1 price/build reads. No generic endpoint, credentials, signer or sender. */
export declare class JupiterV1ReadOnlyProvider {
    private readonly fetcher;
    private readonly maximumReads;
    private reads;
    constructor(fetcher?: typeof fetch, maximumReads?: number);
    quoteExactIn(request: JupiterV1ExactInRequest): Promise<JupiterV1QuoteResponse>;
    buildExactIn(request: JupiterV1ExactInRequest, quote: JupiterV1QuoteResponse): Promise<JupiterV1RawBuildResponse>;
    private read;
}
export declare function validateJupiterV1Request(request: JupiterV1ExactInRequest): void;
/** Production transport pins the validated public DNS result and uses built-in TLS roots. */
export declare const jupiterV1HttpsFetch: typeof fetch;
