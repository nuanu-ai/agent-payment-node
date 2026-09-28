import type { ChainAccount, ChainWalletStoragePort, RailSignedEffect } from "../../direct-rail-ports.js";
import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapOperationRecord } from "../model.js";
import { GuardedSwapService } from "../service.js";
import { type OrcaStableAdmissionPorts } from "./stable-admission.js";
import { SavedOrcaStableMaterialStore, type OrcaStableMaterial } from "./stable-material.js";
import { type OrcaStableUnsignedPreview } from "./stable-prepare.js";
import { type OrcaStableSourceBinding } from "./stable-source-binding.js";
declare const VERSION: "apn.orca-stable-execution-binding.v2";
export interface OrcaStableExecutionPreflight {
    readonly preview: OrcaStableUnsignedPreview;
    readonly checkedAt: string;
    readonly elapsedMs: number;
    readonly physicalPostCount: number;
    readonly simulationHash: string;
}
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
/** Preflight is a trusted effect-port: it must perform fresh RPC reads, exact rebuild and exact-byte simulation. */
export interface OrcaStableExecutionPorts {
    readonly admission: OrcaStableAdmissionPorts;
    readonly preflight: (operation: SwapOperationRecord, material: OrcaStableMaterial) => Promise<OrcaStableExecutionPreflight>;
    readonly sign: (operation: SwapOperationRecord, binding: OrcaStableExecutionBinding, account: ChainAccount) => Promise<RailSignedEffect>;
    readonly effects: Pick<ChainWalletStoragePort, "saveEffect" | "effect">;
}
export interface OrcaStableExecutionSendPorts extends OrcaStableExecutionPorts {
    readonly send: (operationId: string) => Promise<SwapOperationRecord>;
}
/** Internal journal. A crash after the marker makes every later begin call observe-only. */
export declare function beginOrcaStableExecution(service: GuardedSwapService, materials: SavedOrcaStableMaterialStore, bindings: OrcaStableExecutionBindingStore, ports: OrcaStableExecutionPorts, operationId: string, clock: () => Date): Promise<{
    operation: SwapOperationRecord;
    binding: null;
    signature: null;
} | {
    operation: SwapOperationRecord;
    binding: OrcaStableExecutionBinding;
    signature: string;
}>;
/** Private, one-shot first attempt. No CLI/MCP route is exposed until finalized observation is integrated. */
export declare function beginOrcaStableExecutionAndSend(service: GuardedSwapService, materials: SavedOrcaStableMaterialStore, bindings: OrcaStableExecutionBindingStore, ports: OrcaStableExecutionSendPorts, operationId: string, clock: () => Date): Promise<{
    operation: SwapOperationRecord;
    binding: null;
    signature: null;
} | {
    operation: SwapOperationRecord;
    binding: OrcaStableExecutionBinding;
    signature: string;
}>;
export declare class OrcaStableExecutionBindingStore extends SecureStateStore {
    private initialized;
    save(operation: SwapOperationRecord, material: OrcaStableMaterial, preflight: OrcaStableExecutionPreflight): Promise<OrcaStableExecutionBinding>;
    load(operation: SwapOperationRecord, material: OrcaStableMaterial): Promise<OrcaStableExecutionBinding | null>;
    private path;
    private ready;
}
export declare function verifyOrcaStableSignedEffect(effect: RailSignedEffect, binding: OrcaStableExecutionBinding): Promise<void>;
export {};
