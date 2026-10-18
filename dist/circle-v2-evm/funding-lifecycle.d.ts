import { type CircleFundingOperationV2 } from "./funding-operation.js";
import type { EvmUnsentOutcome } from "../evm-unsent-outcome.js";
import type { CircleAmbiguousOutcome, CircleSentOutcome } from "./funding-never-lands.js";
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
    usage(op: CircleFundingOperationV2, target: "unknown_finality" | "finalized" | "failed_confirmed_revert" | "failed_before_effect" | "released_unsubmitted"): Promise<CircleFundingOperationV2["usage"]>;
    /** Never-lands proof and discard for signed-but-unsent bytes (`outcome`) and for possibly-sent bytes (`sentOutcome`, which
     * also requires no receipt). Production runtimes always provide it; injected test ports may omit it. `ambiguous` and
     * `resend` serve a possibly-sent mint or cleanup: the same proofs plus "send the identical sealed bytes again". */
    unsent?: Readonly<{
        outcome(op: CircleFundingOperationV2, effect: CircleEffect): Promise<EvmUnsentOutcome>;
        sentOutcome?(op: CircleFundingOperationV2, effect: CircleEffect): Promise<CircleSentOutcome>;
        ambiguous?(op: CircleFundingOperationV2, effect: CircleEffect): Promise<CircleAmbiguousOutcome>;
        /** Sends exactly these sealed bytes once per command; false when nothing was sent (refused or not accepted). */
        resend?(op: CircleFundingOperationV2, effect: CircleEffect, rawTransaction: Hex): Promise<boolean>;
        discard(op: CircleFundingOperationV2, effect: CircleEffect): Promise<void>;
    }>;
    /** Whether the destination already consumed the issuer message nonce (MessageTransmitter `usedNonces`). */
    messageNonceUsed?(op: CircleFundingOperationV2): Promise<boolean>;
    /** The issuer message is used and no owned mint can land: find the transaction someone else relayed, read-only. The
     * runtime adopts what it finds (no signing, no consent) once the command's locks are released. */
    externalMint?(op: CircleFundingOperationV2): Promise<void>;
}
type Consent = () => void;
export declare function approveCircleFundingSource(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
/** Each marker is fsynced before crossing its boundary. Every refusable check runs before signing; after the
 * submission fence the effect is observed only, never signed or broadcast again. A failure before that fence
 * keeps the effect signed-but-unsent and resumable instead of turning it into a permanent unknown. */
export declare function executeCircleFundingEffect(input: CircleFundingOperationV2, role: CircleRole, ports: CircleFundingLifecyclePorts, token?: Consent): Promise<CircleFundingOperationV2>;
export declare function approveCircleFundingMint(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
export declare function observeCircleFunding(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
export declare function refreshCircleFundingAttestation(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
export declare function cleanupCircleFunding(input: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts): Promise<CircleFundingOperationV2>;
/** Explicit fresh cleanup authority, never source authorization or expiry renewal. */
/** Production retirement custody accepts only the private controller's currently active exact guard. */
export declare function assertCircleFundingEffectGuard(input: CircleFundingOperationV2, effectInput: CircleEffect, guard: () => void): void;
export {};
