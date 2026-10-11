import { type CircleFundingOperationV2 } from "./funding-operation.js";
import type { Hex } from "viem";
import type { CircleFundingMaterial } from "./funding-custody.js";
import { type CircleEffect, type CircleEnvelope, type CircleRole } from "./operation-model.js";
import { type CircleAttestation, type CircleSourceProof, type CircleReceiptProof, type decodeCircleDestination } from "./protocol.js";
export declare function snapshotCircleFundingOperation(value: unknown): CircleFundingOperationV2;
export declare function snapshotCircleFundingEffect(op: CircleFundingOperationV2, value: unknown): CircleEffect;
export interface CircleFundingLifecyclePorts {
    readonly now: () => number;
    consentContext?(): string | null;
    effectAuthorityGuard?(op: CircleFundingOperationV2): void;
    recordEffectFailure?(op: CircleFundingOperationV2, role: CircleRole, error: unknown): Promise<void>;
    save(op: CircleFundingOperationV2): Promise<void>;
    assertOwnerPolicyAndConflicts(op: CircleFundingOperationV2, effectRole?: CircleRole): Promise<void>;
    authorizationDeadline(op: CircleFundingOperationV2): Promise<string | null>;
    approve(op: CircleFundingOperationV2, role: "source" | "mint" | "cleanup" | "cancel", deadline: string): Promise<void>;
    preflight(op: CircleFundingOperationV2, effect: CircleEffect): Promise<void>;
    seal(op: CircleFundingOperationV2, effect: CircleEffect, guard: () => void): Promise<CircleFundingMaterial>;
    loadMaterial(op: CircleFundingOperationV2, effect: CircleEffect): Promise<CircleFundingMaterial | null>;
    broadcast(effect: CircleEffect, raw: Hex, guard: () => void): Promise<Hex>;
    observeEffect(op: CircleFundingOperationV2, effect: CircleEffect): Promise<(CircleReceiptProof & {
        readonly outcome?: "reverted";
    }) | null>;
    observeSource(op: CircleFundingOperationV2, finalized: boolean): Promise<CircleSourceProof | null>;
    observeDestination(op: CircleFundingOperationV2): Promise<ReturnType<typeof decodeCircleDestination> | null>;
    allowance(op: CircleFundingOperationV2): Promise<string>;
    attestation(op: CircleFundingOperationV2): Promise<CircleAttestation | null>;
    mintEnvelope(op: CircleFundingOperationV2): Promise<CircleEnvelope>;
    cleanupEnvelope(op: CircleFundingOperationV2): Promise<CircleEnvelope>;
    usage(op: CircleFundingOperationV2, target: "unknown_finality" | "finalized" | "failed_confirmed_revert" | "failed_before_effect"): Promise<CircleFundingOperationV2["usage"]>;
}
type Consent = () => void;
export declare function approveCircleFundingSource(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
/** Each marker is fsynced before crossing its boundary. Marked recovery never enters signing or broadcast again. */
export declare function executeCircleFundingEffect(input: CircleFundingOperationV2, role: CircleRole, ports: CircleFundingLifecyclePorts, token?: Consent): Promise<CircleFundingOperationV2>;
export declare function approveCircleFundingMint(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
export declare function observeCircleFunding(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
export declare function refreshCircleFundingAttestation(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
export declare function cleanupCircleFunding(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
/** Explicit fresh cleanup authority, never source authorization or expiry renewal. */
export declare function executeCircleFundingCleanupWithConsent(op: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
/** Production retirement custody accepts only the private controller's currently active exact guard. */
export declare function assertCircleFundingEffectGuard(input: CircleFundingOperationV2, effectInput: CircleEffect, guard: () => void): void;
export {};
