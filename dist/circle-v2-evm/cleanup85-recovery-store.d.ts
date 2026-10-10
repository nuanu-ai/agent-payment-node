import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { type EvmNativeCustody } from "../evm-native-custody.js";
import { SecureStateStore } from "../secure-state-store.js";
import { SEALED_BURN_OPERATION } from "./burn-retirement.js";
import { type CircleNonceRetirementIntent } from "./nonce-retirement-store.js";
import { type ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { type CircleOperationV1, type CirclePolicy } from "./operation-model.js";
export declare const CLEANUP85_HASH = "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95";
export declare const CLEANUP85_MATERIAL = "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
export declare const CLEANUP85_ENVELOPE = "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583";
export interface Cleanup85RecoveryIntent {
    readonly version: "apn.circle-cleanup85-recovery.v1";
    readonly parentOperationId: typeof SEALED_BURN_OPERATION;
    readonly parentIntentHash: string;
    readonly parentBinding: string;
    readonly parentPrefix: readonly string[];
    readonly sourceCustody: EvmNativeCustody;
    readonly destinationCustody: EvmNativeCustody;
    readonly recipientCustody: EvmNativeCustody;
    readonly policies: readonly CirclePolicy[];
    readonly capturedAt: string;
    readonly windowEndsAt: string | null;
    readonly evidence: ConsumedBurnEvidence;
    readonly recoveryBinding: string;
}
export declare function assertCleanup85Parent(op: CircleOperationV1, observedOriginal?: boolean): void;
export declare function cleanup85CancellationRequest(intent: Cleanup85RecoveryIntent): Cleanup85CancellationRequest;
export declare function validateCleanup85RecoveryIntent(value: unknown, op: CircleOperationV1, parent: CircleNonceRetirementIntent): Cleanup85RecoveryIntent;
export declare function assertCleanup85Window(i: Cleanup85RecoveryIntent, now: number): void;
export declare class Cleanup85RecoveryStore extends SecureStateStore {
    private path;
    load(op: CircleOperationV1, parent: CircleNonceRetirementIntent): Promise<Cleanup85RecoveryIntent | null>;
    start(op: CircleOperationV1, parent: CircleNonceRetirementIntent, frame: Omit<Cleanup85RecoveryIntent, "version" | "parentOperationId" | "parentIntentHash" | "parentBinding" | "parentPrefix" | "recoveryBinding">): Promise<Cleanup85RecoveryIntent>;
    assertRetainedMaterialHeaders(op: CircleOperationV1, observedOriginal?: boolean): Promise<void>;
    publicRecord(op: CircleOperationV1, suffix: string): Promise<unknown>;
    createPublicRecord(op: CircleOperationV1, suffix: string, value: unknown): Promise<void>;
}
