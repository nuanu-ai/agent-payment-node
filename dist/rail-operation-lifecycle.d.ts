import { ChainPolicyService } from "./chain-policy-service.js";
import type { DirectRailPort, RailEffectBinding, RailInspection, RailSendBinding, RailSignedEffect } from "./direct-rail-ports.js";
import { ApnError } from "./errors.js";
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
    /**
     * The first send of a never-sent signature. A signature sealed in this invocation re-checks only owner policy (no RPC);
     * a recovered one is revalidated against the chain once. Only proof that it can no longer be sent ends it unsent.
     */
    firstLocalSubmit(operation: RailOperationRecord, adapter: DirectRailPort, effect: RailSignedEffect, sealedNow?: boolean): Promise<RailOperationRecord>;
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
/** Owner, chain-policy and allowlist refusals of the frozen transfer, in the codes those services refuse with. */
declare function ownerPolicyRefusal(error: ApnError): boolean;
/** The owner's answer on the approval screen, or a refusal of the frozen transfer by its policies or by the chain. */
declare function approvalRefusal(error: ApnError): boolean;
/** Each pre-effect stop that catches every error: the refusal that keeps the step's reason, and the prefix for the rest. */
declare const RAIL_STOPS: {
    readonly approval: {
        readonly refused: typeof approvalRefusal;
        readonly refusal: "approval_or_pre_effect_validation_refused";
        readonly prefix: "approval_or_pre_effect_validation";
    };
    readonly chain_policy: {
        readonly refused: typeof ownerPolicyRefusal;
        readonly refusal: "chain_policy_refused_at_approval";
        readonly prefix: "chain_policy_check";
    };
    readonly usage_reservation: {
        readonly refused: (error: ApnError) => boolean;
        readonly refusal: "allowlist_refused_at_approval";
        readonly prefix: "usage_reservation";
    };
    readonly pre_sign: {
        readonly refused: (error: ApnError) => boolean;
        readonly refusal: "pre_sign_owner_or_policy_changed";
        readonly prefix: "pre_sign_policy_check";
    };
    readonly pre_send: {
        readonly refused: typeof railEffectProvenUnsendable;
        readonly refusal: "never_submitted_frozen_effect_no_longer_valid";
        readonly prefix: "pre_send_policy_check";
    };
};
/**
 * The saved cause of a stop before any effect. The step's own refusal keeps its reason; any other APN error, such as a
 * state or ledger failure (`APN_STATE_SECURITY`), is `<prefix>_<code in lower case>`, as the Stargate token rail names
 * it, and a non-APN error is `<prefix>_failed`. The stop itself is the same. Records written before keep their reason.
 */
export declare function railStopReason(step: keyof typeof RAIL_STOPS, error: unknown): string;
/** Expiry, funding, fee, owner-policy or custody refusals prove the frozen effect must not be sent; RPC failures prove nothing. */
declare function railEffectProvenUnsendable(error: unknown): boolean;
export declare function binding(operation: RailOperationRecord): RailEffectBinding;
export {};
