import type { BatchBalanceMode, BatchBalanceUnavailable, BatchUnavailableReason } from "../asset-portfolio-reader.js";
import { type PortfolioHttpPort } from "./https.js";
/** A classified failure of one portfolio attempt. Only the reader decides whether it is retried. */
export declare class PortfolioReadFailure extends Error {
    readonly reason: BatchUnavailableReason;
    readonly httpStatus?: number | undefined;
    constructor(reason: BatchUnavailableReason, httpStatus?: number | undefined);
}
/** Counts every HTTP request of one attempt; HTTP 429 and 5xx become classified failures instead of opaque protocol errors. */
export declare class CountingPortfolioHttp {
    private readonly http;
    calls: number;
    methods: number;
    constructor(http: PortfolioHttpPort);
    postJson(url: URL, body: string, methods: number): Promise<string>;
}
export interface JsonRpcCall {
    readonly method: string;
    readonly params: readonly unknown[];
}
export type JsonRpcItem = {
    readonly ok: true;
    readonly value: unknown;
} | {
    readonly ok: false;
};
/** String ids keep lossless (bigint) parsing unambiguous. */
export declare function jsonRpcBatchBody(calls: readonly JsonRpcCall[]): string;
/** Exact batch envelope: one item per request id, in any order, each carrying exactly a result or an error. */
export declare function jsonRpcBatchResults(raw: string, count: number, lossless: boolean): readonly JsonRpcItem[];
/** Converts any attempt failure into the classified unavailable result with the calls actually spent. */
export declare function unavailableAttempt(error: unknown, mode: BatchBalanceMode, counter: CountingPortfolioHttp): BatchBalanceUnavailable;
