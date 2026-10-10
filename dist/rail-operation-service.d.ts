import { ChainPolicyService } from "./chain-policy-service.js";
import type { ChainAssetAlias, DirectRailName } from "./direct-rail-ports.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import type { RuntimeContext } from "./runtime.js";
interface RailPrepareInput {
    readonly profile: string;
    readonly rail: DirectRailName;
    readonly asset: ChainAssetAlias;
    readonly recipient: string;
    readonly amount: string;
    readonly maximumFee: string;
    readonly idempotencyKey: string;
}
export declare class RailOperationService {
    private readonly context;
    readonly records: RailOperationRepository;
    readonly policies: ChainPolicyService;
    private readonly operations;
    private readonly allowlist;
    private readonly lifecycle;
    constructor(context: RuntimeContext);
    prepare(input: RailPrepareInput): Promise<unknown>;
    /** A durable, key-scoped claim survives a crash; only its short commit phases hold money-operation locks. */
    private prepareLocalSolana;
    approve(operationId: string): Promise<unknown>;
    /** The owner prompt and send-window reads run under a durable claim, outside money-operation locks. */
    private approveLocalSolana;
    private failApprovalClaim;
    resume(operationId: string): Promise<unknown>;
    /** Observe an already bound local SOL effect without holding the profile lock during RPC pacing. */
    private resumeLocalSolana;
    receipt(operationId: string): Promise<unknown>;
    private locked;
}
export {};
