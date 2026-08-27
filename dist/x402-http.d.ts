import type { HttpGetRequest, HttpObservation, HttpPort, InspectResult } from "./x402-model.js";
import type { X402HttpObservation } from "./x402-state-integrity.js";
export declare const SELLER_RESPONSE_MAX_HEADER_BYTES: number;
export declare class HttpsX402Http implements HttpPort {
    get(request: HttpGetRequest): Promise<HttpObservation>;
}
export declare function inspectX402(http: HttpPort, value: string): Promise<InspectResult>;
export interface PaidHttpResult {
    readonly observation: X402HttpObservation;
    readonly paymentResponseHeader?: string;
    readonly result?: {
        readonly mediaType: string;
        readonly bodyText: string;
        readonly resultHash: string;
        readonly byteLength: string;
    };
}
export declare function observePaidX402Response(raw: HttpObservation, input: {
    readonly attemptNumber: string;
    readonly purpose: "payment" | "result_recovery";
    readonly canonicalUrl: string;
    readonly targetHash: string;
    readonly origin: string;
}): PaidHttpResult;
