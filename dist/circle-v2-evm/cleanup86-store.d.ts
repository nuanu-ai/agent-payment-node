import { SecureStateStore } from "../secure-state-store.js";
import { type CircleEnvelope, type CirclePolicy, type CircleOperationV1 } from "./operation-model.js";
import { type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
export interface Cleanup86Intent {
    readonly version: "apn.circle-cleanup86-intent.v1";
    readonly recoveryBinding: string;
    readonly cancellationProofHash: string;
    readonly envelope: CircleEnvelope;
    readonly policies: readonly CirclePolicy[];
    readonly capturedAt: string;
    readonly windowEndsAt: string | null;
    readonly intentHash: string;
}
export interface Cleanup86Effect {
    readonly version: "apn.circle-cleanup86-effect.v1";
    readonly intentHash: string;
    readonly phase: "prepared" | "signing_started" | "sealed" | "submission_started" | "unknown";
    readonly transactionHash: `0x${string}` | null;
    readonly materialHash: string | null;
    readonly sequence: number;
    readonly previousHash: string | null;
    readonly effectHash: string;
}
export declare function validateCleanup86Intent(value: unknown, recovery: Cleanup85RecoveryIntent): Cleanup86Intent;
export declare function validateCleanup86Effect(value: unknown, intent: Cleanup86Intent): Cleanup86Effect;
export declare class Cleanup86Store extends SecureStateStore {
    private path;
    intent(op: CircleOperationV1, recovery: Cleanup85RecoveryIntent): Promise<Cleanup86Intent | null>;
    start(op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, body: Omit<Cleanup86Intent, "version" | "intentHash" | "recoveryBinding">): Promise<Cleanup86Intent>;
    effect(op: CircleOperationV1, i: Cleanup86Intent): Promise<Cleanup86Effect | null>;
    saveEffect(op: CircleOperationV1, i: Cleanup86Intent, previous: Cleanup86Effect | null, patch: Pick<Cleanup86Effect, "phase" | "transactionHash" | "materialHash">): Promise<Cleanup86Effect>;
    claimed(op: CircleOperationV1, i: Cleanup86Intent, boundary: "sign" | "send"): Promise<boolean>;
    claim(op: CircleOperationV1, i: Cleanup86Intent, boundary: "sign" | "send", e: Cleanup86Effect): Promise<void>;
    failure(op: CircleOperationV1, i: Cleanup86Intent): Promise<unknown | null>;
    recordFailure(op: CircleOperationV1, i: Cleanup86Intent, code: string, details: unknown): Promise<void>;
}
