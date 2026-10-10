import { StateStore } from "../state.js";
import { type Cleanup86CurrentPurpose, type VerifiedCleanup86CurrentPurpose } from "./cleanup86-current-purpose.js";
import { type Cleanup86RecoveryContext } from "./cleanup85-effective-context.js";
import { SecureStateStore } from "../secure-state-store.js";
import { type CircleEnvelope, type CirclePolicy, type CircleOperationV1 } from "./operation-model.js";
import { type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { type Cleanup86FileIdentity, type Cleanup86Snapshot } from "./cleanup86-snapshot.js";
export interface Cleanup86Intent {
    readonly version: "apn.circle-cleanup86-intent.v1" | "apn.circle-cleanup86-intent.v2" | "apn.circle-cleanup86-intent.v3" | "apn.circle-cleanup86-intent.v4";
    readonly currentPurpose?: Cleanup86CurrentPurpose;
    readonly unsignedPredecessor?: {
        readonly intentHash: string;
        readonly file: Cleanup86FileIdentity;
        readonly rootIdentity: string;
        readonly directoryIdentity: string;
    };
    readonly retirementProofHash?: string;
    readonly freshReadmissionHash?: string;
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
export declare function validateCleanup86Intent(value: unknown, recovery: Cleanup85RecoveryIntent, context?: Cleanup86RecoveryContext, current?: {
    readonly root: string;
    readonly op: CircleOperationV1;
}): Cleanup86Intent;
export declare function validateCleanup86Effect(value: unknown, intent: Cleanup86Intent): Cleanup86Effect;
export declare class Cleanup86Store extends SecureStateStore {
    private path;
    private context;
    private generationPath;
    private legacy;
    intent(op: CircleOperationV1, recovery: Cleanup85RecoveryIntent): Promise<Cleanup86Intent | null>;
    /** A v3 orphan is eligible only with positive stable absence of every financial artifact.
     * This is inspection evidence, never signing authority; the normal command mints a new purpose. */
    unsignedOrphan(op: CircleOperationV1, recovery: Cleanup85RecoveryIntent): Promise<Cleanup86Snapshot>;
    assertGeneration(op: CircleOperationV1, i: Cleanup86Intent): Promise<void>;
    startReprepared(state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope, certificate: VerifiedCleanup86CurrentPurpose, snapshot: Cleanup86Snapshot): Promise<Cleanup86Intent>;
    private pendingPublication;
    private ownedSnapshot;
    protected beforeCreateOnlyPublication(relativePath: string, _value: unknown): Promise<void>;
    private rememberOwn;
    acceptSealedMaterial(op: CircleOperationV1, i: Cleanup86Intent, material: {
        readonly intentHash: string;
        readonly envelopeHash: string;
        readonly materialHash: string;
        readonly transactionHash: string;
    }): Promise<void>;
    start(op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, body: Omit<Cleanup86Intent, "version" | "intentHash" | "recoveryBinding" | "retirementProofHash" | "freshReadmissionHash">): Promise<Cleanup86Intent>;
    startCurrent(state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope, certificate: VerifiedCleanup86CurrentPurpose): Promise<Cleanup86Intent>;
    effect(op: CircleOperationV1, i: Cleanup86Intent): Promise<Cleanup86Effect | null>;
    saveEffect(op: CircleOperationV1, i: Cleanup86Intent, previous: Cleanup86Effect | null, patch: Pick<Cleanup86Effect, "phase" | "transactionHash" | "materialHash">): Promise<Cleanup86Effect>;
    claimed(op: CircleOperationV1, i: Cleanup86Intent, boundary: "sign" | "send"): Promise<boolean>;
    claim(op: CircleOperationV1, i: Cleanup86Intent, boundary: "sign" | "send", e: Cleanup86Effect): Promise<void>;
    failure(op: CircleOperationV1, i: Cleanup86Intent): Promise<unknown | null>;
    recordFailure(op: CircleOperationV1, i: Cleanup86Intent, code: string, details: unknown): Promise<void>;
}
