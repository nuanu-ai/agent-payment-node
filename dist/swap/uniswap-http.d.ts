export interface UniswapHttpTransportResponse {
    readonly status: number;
    readonly body: string;
}
export interface UniswapHttpTransport {
    post(url: string, headers: Readonly<Record<string, string>>, body: string, timeoutMs: number): Promise<UniswapHttpTransportResponse>;
}
export declare class FetchUniswapHttpTransport implements UniswapHttpTransport {
    post(url: string, headers: Readonly<Record<string, string>>, body: string, timeoutMs: number): Promise<UniswapHttpTransportResponse>;
}
export declare class UniswapTradingApi {
    private readonly apiKey;
    private readonly transport;
    private readonly timeoutMs;
    private readonly retries;
    constructor(apiKey: string, transport?: UniswapHttpTransport, timeoutMs?: number, retries?: number);
    quote(body: unknown): Promise<unknown>;
    swap(body: unknown): Promise<unknown>;
    checkApproval(): never;
    private safeUnsignedRead;
}
