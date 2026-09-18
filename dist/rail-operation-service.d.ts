import { ChainPolicyService } from "./chain-policy-service.js";
import type { ChainAssetAlias, DirectRailName } from "./direct-rail-ports.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import type { RuntimeContext } from "./runtime.js";
export declare class RailOperationService {
    private readonly context;
    readonly records: RailOperationRepository;
    readonly policies: ChainPolicyService;
    private readonly operations;
    private readonly allowlist;
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
    /**
     * The send guard re-acquires a validity window and simulates, so a lost read must be re-run
     * rather than reported as a refusal. Only a transport loss is retried, only while the owner's
     * approved window still leaves room to send, and every attempt re-acquires a fresh window.
     */
    private patientBind;
    private revalidate;
    private firstLocalSubmit;
    private submit;
    private inspect;
    private assertEffect;
    private move;
    /** After the foreground decision and every pre-send check, before signing or a provider send. Refusals end the operation. */
    private reserveUsage;
    /** The journal owns the effect state; the shared usage ledger follows it forward, idempotently. */
    private followUsage;
}
