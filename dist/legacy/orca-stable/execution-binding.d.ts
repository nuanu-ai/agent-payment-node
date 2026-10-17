import type { RailSignedEffect } from "../../direct-rail-ports.js";
import { SecureStateStore } from "../../secure-state-store.js";
import type { SwapOperationRecord } from "../../swap/model.js";
import type { OrcaStableMaterial } from "./material.js";
import { type OrcaStableUnsignedPreview } from "./preview.js";
import { type OrcaStableSourceBinding } from "./source-binding.js";
declare const VERSION: "apn.orca-stable-execution-binding.v2";
export interface OrcaStableExecutionBinding {
    readonly schemaVersion: typeof VERSION;
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly submissionMarkerHash: string;
    readonly materialDigest: string;
    readonly policyDigest: string;
    readonly activationDigest: string;
    readonly sourceBinding: OrcaStableSourceBinding;
    readonly preview: OrcaStableUnsignedPreview;
    readonly checkedAt: string;
    readonly elapsedMs: number;
    readonly physicalPostCount: number;
    readonly simulationHash: string;
    readonly bindingHash: string;
}
/** Frozen reader of the execution binding a released stable execution wrote after its marker. */
export declare class OrcaStableExecutionBindingStore extends SecureStateStore {
    private initialized;
    load(operation: SwapOperationRecord, material: OrcaStableMaterial): Promise<OrcaStableExecutionBinding | null>;
    private path;
    private ready;
}
export declare function verifyOrcaStableSignedEffect(effect: RailSignedEffect, binding: OrcaStableExecutionBinding): Promise<void>;
export {};
