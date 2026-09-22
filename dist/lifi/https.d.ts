import { resolvePublicAddresses } from "../network-policy.js";
import type { LifiResponse } from "./ports.js";
/** Fixed LI.FI API base. Credentials are never sent to another origin or path. */
export declare const LIFI_API_ORIGIN = "https://li.quest/v1";
/** Shared finite transport: public DNS pin, default TLS, no redirect or implicit retry. */
export declare class BridgeHttps {
    #private;
    private readonly resolveAddresses;
    private readonly requestTimeoutMs;
    private active;
    private readonly waiting;
    constructor(resolveAddresses?: typeof resolvePublicAddresses, lifiApiKey?: string, requestTimeoutMs?: number);
    request(endpointInput: string, method: "GET" | "POST", body: string | null, maximumBytes: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<LifiResponse>;
}
