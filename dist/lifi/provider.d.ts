import type { Address } from "../model.js";
import type { BridgeProviderObservation, BridgeRouteRequest } from "./model.js";
import type { LifiProviderPort, LifiResponse } from "./ports.js";
export declare const LIFI_ROUTE_RESPONSE_BYTES: number;
export declare const LIFI_INVENTORY_RESPONSE_BYTES: number;
export interface LifiTransport {
    request(endpoint: string, method: "GET" | "POST", body: string | null, maximumBytes: number, code: "APN_HTTP_CONFIG"): Promise<LifiResponse>;
}
export declare class LifiProvider implements LifiProviderPort {
    private readonly transport;
    private readonly now;
    constructor(transport?: LifiTransport, now?: () => number);
    inventory(): Promise<Readonly<Record<"chains" | "tokens" | "tools" | "connections", LifiResponse>>>;
    routes(request: BridgeRouteRequest, sender: Address): Promise<LifiResponse>;
    materialize(step: Readonly<Record<string, unknown>>): Promise<LifiResponse>;
    status(input: Parameters<LifiProviderPort["status"]>[0]): Promise<BridgeProviderObservation>;
    private get;
}
export declare function normalizeLifiStatus(response: LifiResponse, observedAt: string): BridgeProviderObservation;
