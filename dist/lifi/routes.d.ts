import type { Address } from "../model.js";
import type { BridgeMaterialization, BridgeRouteRequest } from "./model.js";
import type { LifiResponse } from "./ports.js";
export interface BridgeRouteChoice {
    readonly routeId: string;
    readonly stepId: string;
    readonly tool: string;
    readonly quotedOutputAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly routeHash: string;
    readonly stepHash: string;
    readonly stepIdentityHash: string;
    readonly preparable: boolean;
    readonly unavailableReason: string | null;
}
export interface ParsedBridgeRoute {
    readonly choice: BridgeRouteChoice;
    readonly route: Record<string, unknown>;
    readonly step: Record<string, unknown>;
}
export declare function parseBridgeRoutes(response: LifiResponse, request: BridgeRouteRequest, sender: Address): readonly ParsedBridgeRoute[];
export declare function materializeBridgeRoute(selected: ParsedBridgeRoute, response: LifiResponse, request: BridgeRouteRequest, sender: Address): {
    readonly materialization: BridgeMaterialization;
    readonly implicitProtocolFeeAtomic: string;
    readonly providerNonceAtomic: string | null;
};
/**
 * The token economics of one materialized route, and its unitemized protocol fee in source atomic units. A scaled pair
 * (Binance-Peg 18 decimals against 6) compares output, loss and fees exactly at the finer precision; its unitemized fee
 * counts the output at the source precision rounded down, so the fee is never understated.
 */
export declare function validateRouteEconomics(m: BridgeMaterialization): string;
export declare function bridgeRouteProjection(choice: BridgeRouteChoice): {
    route_id: string;
    step_id: string;
    tool: string;
    quoted_output_atomic: string;
    minimum_output_atomic: string;
    preparable: boolean;
    executable: boolean;
    executability_gate: string;
    route_hash: string;
};
