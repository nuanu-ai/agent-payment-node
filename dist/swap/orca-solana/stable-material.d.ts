import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapOperationRecord } from "../model.js";
import { type OrcaStableUnsignedPreview } from "./stable-prepare.js";
export declare const ORCA_STABLE_MATERIAL_SCHEMA: "apn.orca-stable-guarded-material.v1";
export interface OrcaStableMaterial {
    readonly schemaVersion: typeof ORCA_STABLE_MATERIAL_SCHEMA;
    readonly operationId: string;
    readonly quote: SwapOperationRecord["quote"];
    readonly policyRevision: number;
    readonly policyDigest: string;
    readonly activationDigest: string;
    readonly evidence: unknown;
    readonly preview: OrcaStableUnsignedPreview;
    readonly materialDigest: string;
}
export declare function sealOrcaStableMaterial(input: Omit<OrcaStableMaterial, "schemaVersion" | "materialDigest">, operation: SwapOperationRecord): Promise<OrcaStableMaterial>;
export declare function validateOrcaStableMaterial(value: OrcaStableMaterial, operation: SwapOperationRecord): Promise<OrcaStableMaterial>;
export declare class SavedOrcaStableMaterialStore extends SecureStateStore {
    private initialized;
    save(value: OrcaStableMaterial, operation: SwapOperationRecord): Promise<OrcaStableMaterial>;
    load(operationId: string, operation: SwapOperationRecord): Promise<OrcaStableMaterial | null>;
    private path;
    private ready;
}
