export declare const PORTFOLIO_REQUEST_TIMEOUT_MS = 10000;
export declare const PORTFOLIO_MAX_RESPONSE_BYTES: number;
export interface PortfolioHttpResponse {
    readonly status: number;
    readonly contentType: string;
    readonly body: string;
}
/** One HTTPS POST. Any HTTP status is returned to the caller; only transport failures throw. */
export interface PortfolioHttpPort {
    post(url: URL, body: string): Promise<PortfolioHttpResponse>;
}
export type PortfolioTransportFailureKind = "timeout" | "unreachable" | "refused";
/** `refused` is a local safety refusal (non-public target, pin change, encoding, size) and is never retried. */
export declare class PortfolioTransportFailure extends Error {
    readonly kind: PortfolioTransportFailureKind;
    constructor(kind: PortfolioTransportFailureKind);
}
/** Read-only transport: public DNS pin, built-in TLS roots, no redirect following, no compression, bounded size and time. */
export declare class PortfolioHttps implements PortfolioHttpPort {
    post(url: URL, body: string): Promise<PortfolioHttpResponse>;
}
