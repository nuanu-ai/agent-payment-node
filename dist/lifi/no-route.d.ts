import type { BridgeRouteRequest } from "./model.js";
export interface BridgeNoRouteFilteredRow {
    readonly path: string;
    readonly reason: string;
}
export interface BridgeNoRouteFailedRow {
    readonly path: string;
    readonly step: string;
    readonly tool: string;
    readonly error_type: string;
    readonly code: string;
    readonly message: string;
}
/**
 * Why `bridge routes` lists nothing: LI.FI's own answer to the exact request APN sent. APN drops no returned route (every
 * route LI.FI returns is listed, preparable or with its gate), so an empty list is the provider's: `filtered_out` and
 * `failed` are LI.FI's `unavailableRoutes` rows, and `provider_reported` says whether it sent that object at all.
 */
export interface BridgeNoRouteEvidence {
    readonly reason: "provider_returned_no_route";
    readonly provider: "lifi";
    readonly endpoint: string;
    readonly from_chain: string;
    readonly to_chain: string;
    readonly from_token: string;
    readonly to_token: string;
    readonly amount_atomic: string;
    readonly requested_tools: {
        readonly bridges: readonly string[];
        readonly exchanges: readonly string[];
        readonly allow_destination_call: boolean;
    };
    readonly provider_reported: boolean;
    readonly filtered_out: readonly BridgeNoRouteFilteredRow[];
    readonly failed: readonly BridgeNoRouteFailedRow[];
    readonly omitted_rows: number;
}
export declare function bridgeNoRouteEvidence(rawResponse: string, request: BridgeRouteRequest): BridgeNoRouteEvidence;
