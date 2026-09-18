import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapOperationRecord } from "../model.js";
import type { SunSwapPreparedMaterial } from "./prepared.js";
declare const BINDING_VERSION: "apn.sunswap-tron.execution-binding.v1";
/** Fresh head evidence taken by the pre-send guard, immediately before the submission marker. */
export interface SunSwapExecutionFreshness {
    readonly headBlockNumber: string;
    readonly headBlockId: string;
    readonly headTimestampMs: string;
    readonly simulatedOutputAtomic: string;
    readonly simulatedEnergy: string;
    readonly balanceSun: string;
    readonly checkedAt: string;
}
export interface SunSwapTronExecutionBinding extends SunSwapExecutionFreshness {
    readonly schemaVersion: typeof BINDING_VERSION;
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly profileHash: string;
    readonly account: string;
    readonly accountIdentityHash: string;
    readonly ownerAdmissionHash: string;
    readonly effectFingerprint: string;
    readonly txID: string;
    readonly unsignedTransactionPayloadHash: string;
    readonly feeLimitSun: string;
    readonly maximumTrxDebitSun: string;
    readonly expirationMs: string;
    readonly quoteHash: string;
    readonly policyDigest: string;
    readonly mechanismDigest: string;
    readonly protocolRegistryDigest: string;
    readonly approvalArtifactHash: string;
    readonly submissionMarkerHash: string;
    readonly bindingHash: string;
}
export declare function createSunSwapTronExecutionBinding(input: {
    readonly operation: SwapOperationRecord;
    readonly material: SunSwapPreparedMaterial;
    readonly freshness: SunSwapExecutionFreshness;
    readonly accountIdentityHash: string;
    readonly ownerAdmissionHash: string;
    readonly effectFingerprint: string;
    readonly approvalArtifactHash: string;
}): SunSwapTronExecutionBinding;
export declare function validateSunSwapTronExecutionBinding(value: unknown, operationValue: SwapOperationRecord, material: SunSwapPreparedMaterial): SunSwapTronExecutionBinding;
/**
 * Durable execution binding, written after the submission marker and before signing. It holds no secret: signed bytes
 * stay in the encrypted chain wallet, and resume only observes the exact transaction id.
 */
export declare class SunSwapExecutionBindingStore extends SecureStateStore {
    private initialized;
    save(operation: SwapOperationRecord, material: SunSwapPreparedMaterial, value: SunSwapTronExecutionBinding): Promise<SunSwapTronExecutionBinding>;
    load(operation: SwapOperationRecord, material: SunSwapPreparedMaterial): Promise<SunSwapTronExecutionBinding | null>;
    private path;
    private ready;
}
export {};
