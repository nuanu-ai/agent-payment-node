import type { RailSignedEffect } from "../../direct-rail-ports.js";
import { SecureStateStore } from "../../secure-state-store.js";
import type { SwapOperationRecord } from "../model.js";
import { type JupiterV1PreparedMaterial, type JupiterV1ResolvedMaterial } from "./v1-material.js";
import { type JupiterV1OwnerBinding } from "./v1-admission.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { GuardedSwapApprovalArtifact } from "../runtime.js";
import type { JupiterV1SimulationProof } from "./v1-proof.js";
declare const SCHEMA: "apn.jupiter-v1-execution-binding.v1";
export interface JupiterV1ExecutionBinding {
    readonly schemaVersion: typeof SCHEMA;
    readonly operationId: string;
    readonly markerHash: string;
    readonly quoteHash: string;
    readonly materialDigest: string;
    readonly messageHash: string;
    readonly unsignedPayload: string;
    readonly accountBindingHash: string;
    readonly policyDigest: string;
    readonly activationDigest: string;
    readonly ownerAdmissionHash: string;
    readonly checkedAt: string;
    readonly freshMaterialDigest: string;
    readonly freshAdmissionDigest: string;
    readonly proofDigest: string;
    readonly simulation: JupiterV1SimulationProof;
    readonly bindingHash: string;
}
export declare function createJupiterV1ExecutionBinding(operation: SwapOperationRecord, material: JupiterV1PreparedMaterial, admission: JupiterV1OwnerBinding, simulation: JupiterV1SimulationProof, checkedAt: Date, fresh: JupiterV1ResolvedMaterial): JupiterV1ExecutionBinding;
export declare function validateJupiterV1ExecutionBinding(value: unknown, operationValue: SwapOperationRecord, materialValue: JupiterV1PreparedMaterial): JupiterV1ExecutionBinding;
export interface JupiterV1SendClaim {
    readonly schemaVersion: "apn.jupiter-v1-send-claim.v1";
    readonly operationId: string;
    readonly markerHash: string;
    readonly bindingHash: string;
    readonly signature: string;
    readonly rawPayloadHash: string;
    readonly claimedAt: string;
    readonly claimHash: string;
}
/** Public hashes and signature only. Exact signed bytes stay in encrypted custody. Every create is fsynced. */
export declare class JupiterV1ExecutionBindingStore extends SecureStateStore {
    private initialized;
    save(op: SwapOperationRecord, value: JupiterV1ExecutionBinding, m: JupiterV1PreparedMaterial): Promise<JupiterV1ExecutionBinding>;
    load(op: SwapOperationRecord, m: JupiterV1PreparedMaterial): Promise<JupiterV1ExecutionBinding | null>;
    loadClaim(op: SwapOperationRecord): Promise<JupiterV1SendClaim | null>;
    /** Caller holds the common Jupiter operation lock. Occupied invalid claims fail closed permanently. */
    claim(op: SwapOperationRecord, b: JupiterV1ExecutionBinding, effect: RailSignedEffect, now: Date): Promise<void>;
    saveSignature(op: SwapOperationRecord, b: JupiterV1ExecutionBinding, effect: RailSignedEffect): Promise<void>;
    loadSignature(op: SwapOperationRecord, b: JupiterV1ExecutionBinding): Promise<string | null>;
    saveFresh(op: SwapOperationRecord, fresh: JupiterV1ResolvedMaterial, proof: JupiterV1SimulationProof): Promise<void>;
    loadFresh(op: SwapOperationRecord, b: JupiterV1ExecutionBinding): Promise<{
        fresh: JupiterV1ResolvedMaterial;
        proof: JupiterV1SimulationProof;
    }>;
    bindPrepared(op: SwapOperationRecord, admission: JupiterV1OwnerBinding, material: JupiterV1PreparedMaterial): Promise<void>;
    assertPrepared(op: SwapOperationRecord, admission: JupiterV1OwnerBinding, material: JupiterV1PreparedMaterial): Promise<void>;
    private path;
    private ready;
}
export declare function verifySignedJupiterV1Transaction(effect: RailSignedEffect, binding: JupiterV1ExecutionBinding): Promise<void>;
/** The finite local Jupiter signer owns the canonical software custody instance and its one-shot TTY grants. */
export declare class JupiterV1LocalSigner {
    #private;
    static assertGenuine(value: JupiterV1LocalSigner, root: string): void;
    constructor(root: string, wrappingSecret: WrappingSecretPort);
    publicOwner(profile: string, expected?: string): Promise<import("../../direct-rail-ports.js").ChainAccount>;
    /** The intent is detached synchronously before the first await. No returned artifact alone authorizes signing. */
    approve(operationValue: SwapOperationRecord, materialValue: JupiterV1PreparedMaterial, admissionValue: JupiterV1OwnerBinding): Promise<GuardedSwapApprovalArtifact>;
    sign(operationValue: SwapOperationRecord, bindingValue: JupiterV1ExecutionBinding, materialValue: JupiterV1PreparedMaterial, admissionValue: JupiterV1OwnerBinding): Promise<RailSignedEffect>;
    private assertWrappingFence;
    assertDispatchAdmission(operation: SwapOperationRecord, binding: JupiterV1ExecutionBinding): Promise<void>;
    private assertPolicy;
    private assertActive;
    hasForegroundGrant(operation: SwapOperationRecord): boolean;
    savedEffect(operation: SwapOperationRecord, binding: JupiterV1ExecutionBinding): Promise<RailSignedEffect | null>;
}
export {};
