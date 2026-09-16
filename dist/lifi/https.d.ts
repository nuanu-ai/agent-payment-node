import { resolvePublicAddresses } from "../network-policy.js";
import type { LifiResponse } from "./ports.js";
/** Shared finite transport: public DNS pin, default TLS, no redirect or implicit retry. */
export declare class BridgeHttps {
    private readonly resolveAddresses;
    private active;
    private readonly waiting;
    constructor(resolveAddresses?: typeof resolvePublicAddresses);
    request(endpointInput: string, method: "GET" | "POST", body: string | null, maximumBytes: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<LifiResponse>;
}
