import type { ChainAccount, ChainWalletStoragePort, RailSignedEffect } from "../../direct-rail-ports.js";
import { SecureStateStore } from "../../secure-state-store.js";
import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type SwapOperationRecord } from "../model.js";
import { type OrcaOwnerAdmission } from "./admission.js";
import { type OrcaSwapLifetime } from "./instructions.js";
import { type OrcaKeylessMaterial } from "./material.js";
import type { OrcaSimulationEvidence } from "./simulation.js";
declare const BINDING_VERSION: "apn.orca-whirlpool-execution-binding.v1";
/** Post-approval facts taken at the send boundary: a fresh lifetime and the exact-bytes simulation. */
export interface OrcaExecutionFreshness {
    readonly lifetime: OrcaSwapLifetime;
    readonly unsignedPayload: string;
    readonly messageHash: string;
    readonly networkFeeLamports: string;
    readonly simulation: OrcaSimulationEvidence;
    readonly blockHeight: string;
    readonly checkedAt: string;
}
export interface OrcaExecutionBinding extends OrcaExecutionFreshness {
    readonly schemaVersion: typeof BINDING_VERSION;
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly profileHash: string;
    readonly account: string;
    readonly accountBindingHash: string;
    readonly ownerAdmissionHash: string;
    readonly quoteHash: string;
    readonly submissionMarkerHash: string;
    readonly policyDigest: string;
    readonly mechanismDigest: string;
    readonly protocolRegistryDigest: string;
    readonly bindingHash: string;
}
export declare function createOrcaExecutionBinding(input: {
    readonly operation: SwapOperationRecord;
    readonly material: OrcaKeylessMaterial;
    readonly freshness: OrcaExecutionFreshness;
    readonly admission: OrcaOwnerAdmission;
}): OrcaExecutionBinding;
/** Re-derives the exact signed-to-be bytes from the stored plan and the recorded lifetime; any drift is corruption. */
export declare function validateOrcaExecutionBinding(value: unknown, operationValue: SwapOperationRecord, materialValue: OrcaKeylessMaterial): OrcaExecutionBinding;
/** Durable binding written after the submission marker and before signing. It holds no secret. */
export declare class OrcaExecutionBindingStore extends SecureStateStore {
    private initialized;
    save(operation: SwapOperationRecord, value: OrcaExecutionBinding, material: OrcaKeylessMaterial): Promise<OrcaExecutionBinding>;
    load(operation: SwapOperationRecord, material: OrcaKeylessMaterial): Promise<OrcaExecutionBinding | null>;
    private path;
    private ready;
}
/** Opens the local Solana seed only inside the signing call and seals the signed bytes in the encrypted wallet state. */
export declare class OrcaLocalSigner {
    private readonly accounts;
    constructor(accounts: Pick<ChainWalletStoragePort, "withSeed" | "effect" | "saveEffect">);
    sign(operation: SwapOperationRecord, binding: OrcaExecutionBinding, material: OrcaKeylessMaterial, account: ChainAccount): Promise<RailSignedEffect>;
}
export declare function verifySignedOrcaTransaction(effect: RailSignedEffect, binding: OrcaExecutionBinding): Promise<string>;
/** One sendTransaction call. It never throws: any failure is an ambiguous possible send that only status may resolve. */
export declare class OrcaSingleSender {
    private readonly rpc;
    constructor(rpc: SolanaRpcPort);
    sendOnce(effect: RailSignedEffect): Promise<"submitted" | "possible_send">;
}
export {};
