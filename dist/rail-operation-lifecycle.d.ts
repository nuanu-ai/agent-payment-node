import { ChainPolicyService } from "./chain-policy-service.js";
import type { DirectRailPort, RailEffectBinding, RailInspection, RailSendBinding, RailSignedEffect } from "./direct-rail-ports.js";
import type { OperationService } from "./operation-service.js";
import { type RailOperationRecord, type RailState } from "./rail-operation-model.js";
import type { RailOperationRepository } from "./rail-operation-repository.js";
import type { RuntimeContext } from "./runtime.js";
import { DirectAllowlistGate } from "./direct-allowlist-gate.js";
import type { DirectAssetUsageLease } from "./direct-asset-usage.js";
/** Internal lifecycle dependencies; signing stays on the already admitted rail adapter. */
interface RailLifecyclePorts {
    readonly context: RuntimeContext;
    readonly records: RailOperationRepository;
    readonly policies: ChainPolicyService;
    readonly operations: Pick<OperationService, "required">;
    readonly allowlist: DirectAllowlistGate;
}
export declare class RailOperationLifecycle {
    private readonly context;
    private readonly records;
    private readonly policies;
    private readonly operations;
    private readonly allowlist;
    constructor(ports: RailLifecyclePorts);
    finishLocalApproval(operation: RailOperationRecord, adapter: DirectRailPort): Promise<RailOperationRecord>;
    /** The claim lock serializes recovery, while RPC revalidation and the one send run outside money-operation locks. */
    executeLocalSolanaClaimed(initial: RailOperationRecord, adapter: DirectRailPort, mayStartSigning?: boolean): Promise<unknown>;
    resumeLocalSolanaPhase(operationId: string, profileHash: string, hasClaim: boolean): Promise<unknown>;
    required(operationId: string): Promise<RailOperationRecord>;
    adapter(operation: RailOperationRecord): DirectRailPort;
    /**
     * The send guard re-acquires a validity window and simulates, so a lost read must be re-run
     * rather than reported as a refusal. Only a transport loss is retried, only while the owner's
     * approved window still leaves room to send, and every attempt re-acquires a fresh window.
     */
    patientBind(operation: RailOperationRecord, bind: NonNullable<DirectRailPort["bindSend"]>): Promise<RailSendBinding>;
    revalidate(operation: RailOperationRecord, adapter: DirectRailPort): Promise<void>;
    assertCurrentRailPolicy(operation: RailOperationRecord): Promise<RailOperationRecord["account"]>;
    firstLocalSubmit(operation: RailOperationRecord, adapter: DirectRailPort, effect: RailSignedEffect): Promise<RailOperationRecord>;
    submit(operation: RailOperationRecord, adapter: DirectRailPort, effect: RailSignedEffect | null, allowlistLease?: DirectAssetUsageLease): Promise<RailOperationRecord>;
    inspect(operation: RailOperationRecord, adapter: DirectRailPort): Promise<RailOperationRecord>;
    inspectEvidence(operation: RailOperationRecord, adapter: DirectRailPort): Promise<RailInspection | null>;
    assertEffect(operation: RailOperationRecord, effect: RailSignedEffect): void;
    move(operation: RailOperationRecord, state: RailState, reason: string, proofClass: string, effect?: {
        readonly transactionId: string;
        readonly rawPayloadHash?: string;
    } | undefined, send?: RailSendBinding | undefined, allowlistLease?: DirectAssetUsageLease | undefined): Promise<RailOperationRecord>;
    /** After the foreground decision and every pre-send check, before signing or a provider send. Refusals end the operation. */
    reserveUsage(operation: RailOperationRecord): Promise<DirectAssetUsageLease>;
    /** The journal owns the effect state; the shared usage ledger follows it forward, idempotently. */
    followUsage(operation: RailOperationRecord): Promise<RailOperationRecord>;
}
export declare function binding(operation: RailOperationRecord): RailEffectBinding;
export {};
