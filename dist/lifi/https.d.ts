import type { LifiResponse } from "./ports.js";
/** Shared finite transport: public DNS pin, default TLS, no redirect or implicit retry. */
export declare class BridgeHttps {
    private active;
    private readonly waiting;
    request(endpointInput: string, method: "GET" | "POST", body: string | null, maximumBytes: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<LifiResponse>;
}
