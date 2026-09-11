export interface GaslessTransport {
    request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<{
        readonly status: number;
        readonly body: string;
    }>;
}
/** Finite public HTTPS transport: DNS pinning, default TLS, no redirects and no retries. */
export declare class GaslessHttps implements GaslessTransport {
    private active;
    private readonly waiting;
    request(endpointInput: string, method: "POST" | "GET", body: string | null, maximumBytes: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<{
        readonly status: number;
        readonly body: string;
    }>;
    private acquire;
    private releaser;
}
