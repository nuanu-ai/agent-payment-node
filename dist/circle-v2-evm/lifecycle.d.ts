import type { Hex } from "viem";
import type { CircleMaterial } from "./custody.js";
import { type CircleEffect, type CircleEnvelope, type CircleOperationV1, type CircleRole } from "./operation-model.js";
import { type CircleAttestation, type CircleSourceProof, type CircleReceiptProof, type decodeCircleDestination } from "./protocol.js";
export interface CircleLifecyclePorts {
    readonly now: () => number;
    save(op: CircleOperationV1): Promise<void>;
    assertOwnerPolicyAndConflicts(op: CircleOperationV1, effectRole?: CircleRole): Promise<void>;
    authorizationDeadline(op: CircleOperationV1): Promise<string | null>;
    approve(op: CircleOperationV1, role: "source" | "mint" | "cleanup" | "cancel", deadline: string): Promise<void>;
    preflight(op: CircleOperationV1, effect: CircleEffect): Promise<void>;
    seal(op: CircleOperationV1, effect: CircleEffect, guard: () => void): Promise<CircleMaterial>;
    loadMaterial(op: CircleOperationV1, effect: CircleEffect): Promise<CircleMaterial | null>;
    broadcast(effect: CircleEffect, raw: Hex, guard: () => void): Promise<Hex>;
    observeEffect(op: CircleOperationV1, effect: CircleEffect): Promise<(CircleReceiptProof & {
        readonly outcome?: "reverted";
    }) | null>;
    observeSource(op: CircleOperationV1, finalized: boolean): Promise<CircleSourceProof | null>;
    observeDestination(op: CircleOperationV1): Promise<ReturnType<typeof decodeCircleDestination> | null>;
    allowance(op: CircleOperationV1): Promise<string>;
    attestation(op: CircleOperationV1): Promise<CircleAttestation | null>;
    mintEnvelope(op: CircleOperationV1): Promise<CircleEnvelope>;
    cleanupEnvelope(op: CircleOperationV1): Promise<CircleEnvelope>;
    usage(op: CircleOperationV1, target: "unknown_finality" | "finalized" | "failed_confirmed_revert" | "failed_before_effect"): Promise<CircleOperationV1["usage"]>;
}
type Consent = () => void;
export declare function approveCircleSource(input: CircleOperationV1, ports: CircleLifecyclePorts): Promise<CircleOperationV1>;
/** Each marker is fsynced before crossing its boundary. Marked recovery never enters signing or broadcast again. */
export declare function executeCircleEffect(input: CircleOperationV1, role: CircleRole, ports: CircleLifecyclePorts, token?: Consent): Promise<CircleOperationV1>;
export declare function approveCircleMint(input: CircleOperationV1, ports: CircleLifecyclePorts): Promise<CircleOperationV1>;
export declare function observeCircle(input: CircleOperationV1, ports: CircleLifecyclePorts): Promise<CircleOperationV1>;
export declare function refreshCircleAttestation(input: CircleOperationV1, ports: CircleLifecyclePorts): Promise<CircleOperationV1>;
export declare function cleanupCircle(input: CircleOperationV1, ports: CircleLifecyclePorts): Promise<CircleOperationV1>;
export {};
