import { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import type { BridgeRouteRequest } from "./model.js";
import { type BridgeOperationRecord } from "./operation-model.js";
import { BridgeOperationRepository } from "./operation-repository.js";
import type { BridgeRpcFactory, LifiProviderPort } from "./ports.js";
import { BridgeQuoteRepository } from "./quote-repository.js";
export interface BridgePreparationOptions {
    readonly state: StateStore;
    readonly records: BridgeOperationRepository;
    readonly quotes: BridgeQuoteRepository;
    readonly operations: OperationService;
    readonly provider: LifiProviderPort;
    readonly rpcFor: BridgeRpcFactory;
    readonly now: () => number;
}
export declare class BridgePreparation {
    private readonly o;
    constructor(o: BridgePreparationOptions);
    routes(profileInput: string, requestInput: BridgeRouteRequest): Promise<{
        quote_hash: string;
        profile: string;
        request: BridgeRouteRequest;
        response_hash: string;
        created_at: string;
        routes: {
            route_id: string;
            step_id: string;
            tool: string;
            quoted_output_atomic: string;
            minimum_output_atomic: string;
            preparable: boolean;
            executable: boolean;
            executability_gate: string;
            route_hash: string;
        }[];
        mainnet_acceptance: string;
    }>;
    prepare(input: {
        readonly profile: string;
        readonly quote: string;
        readonly route: string;
        readonly idempotencyKey: string;
    }): Promise<BridgeOperationRecord>;
}
