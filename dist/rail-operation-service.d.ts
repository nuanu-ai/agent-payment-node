import { ChainPolicyService } from "./chain-policy-service.js";
import type { ChainAssetAlias, DirectRailName } from "./direct-rail-ports.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import type { RuntimeContext } from "./runtime.js";
export declare class RailOperationService {
    private readonly context;
    readonly records: RailOperationRepository;
    readonly policies: ChainPolicyService;
    private readonly operations;
    constructor(context: RuntimeContext);
    prepare(input: {
        readonly profile: string;
        readonly rail: DirectRailName;
        readonly asset: ChainAssetAlias;
        readonly recipient: string;
        readonly amount: string;
        readonly maximumFee: string;
        readonly idempotencyKey: string;
    }): Promise<unknown>;
    approve(operationId: string): Promise<unknown>;
    resume(operationId: string): Promise<unknown>;
    receipt(operationId: string): Promise<unknown>;
    private locked;
    private required;
    private adapter;
    private revalidate;
    private firstLocalSubmit;
    private submit;
    private inspect;
    private assertEffect;
    private move;
}
