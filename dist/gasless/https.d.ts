export interface GaslessTransport {
    request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG", beforeSend?: () => void): Promise<{
        readonly status: number;
        readonly body: string;
    }>;
}
/** HTTP refusal is decided from the status line before untrusted headers or body are parsed. */
export declare function gaslessResponseDisposition(status: number, encoding: string | string[] | undefined, declared: string | string[] | undefined, maximumBytes: number): "terminal" | "reject" | "read";
/** One queue per provider family, shared by all gasless HTTPS clients in this process. */
export declare class GaslessPostPacer {
    private readonly now;
    private readonly wait;
    private readonly families;
    constructor(now?: () => number, wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>);
    run<T>(endpoint: string, signal: AbortSignal, sendPost: () => Promise<T>): Promise<T>;
}
/** Finite public HTTPS transport: DNS pinning, default TLS, no redirects and no retries. */
export declare class GaslessHttps implements GaslessTransport {
    private readonly pacer;
    private active;
    private readonly waiting;
    constructor(pacer?: GaslessPostPacer);
    request(endpointInput: string, method: "POST" | "GET", body: string | null, maximumBytes: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG", beforeSend?: () => void): Promise<{
        readonly status: number;
        readonly body: string;
    }>;
    private acquire;
    private releaser;
}
