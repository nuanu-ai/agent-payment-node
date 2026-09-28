import type { ChainAccount, ChainWalletStoragePort, RailSignedEffect } from "../../direct-rail-ports.js";
import { SolanaRpc } from "../../solana/rpc.js";
import { GuardedSwapService } from "../service.js";
import type { SwapOperationRecord } from "../model.js";
import { OrcaStableExecutionBindingStore, type OrcaStableExecutionBinding } from "./stable-execution-journal.js";
import type { OrcaStableAdmissionPorts } from "./stable-admission.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import type { OrcaProgramPinVerifier } from "./pins.js";
/** Signs the exact preflight message once. The caller owns the operation lock and persists the result before sending. */
export declare class OrcaStableLocalSigner {
    private readonly custody;
    constructor(custody: Pick<ChainWalletStoragePort, "withSeed">);
    sign(operation: SwapOperationRecord, binding: OrcaStableExecutionBinding, account: ChainAccount): Promise<RailSignedEffect>;
}
declare const SEND_CLAIM_VERSION: "apn.orca-stable-send-claim.v1";
export type OrcaStableSendClaim = {
    readonly schemaVersion: typeof SEND_CLAIM_VERSION;
    readonly operationId: string;
    readonly markerHash: string;
    readonly bindingHash: string;
    readonly accountIdentityHash: string;
    readonly signature: string;
    readonly rawPayloadHash: string;
    readonly claimedAt: string;
    readonly claimHash: string;
};
/** Recovery cannot release principal after a send right was consumed, even if custody is later unreadable. */
export declare function hasOrcaStableSendClaim(root: string, operation: SwapOperationRecord): Promise<boolean>;
export declare function loadOrcaStableSendClaim(root: string, operation: SwapOperationRecord): Promise<OrcaStableSendClaim | null>;
/** Publicly importable sender: it reloads durable state and acquires the shared operation lock itself. */
export declare class OrcaStableSingleSender {
    private readonly service;
    private readonly materials;
    private readonly bindings;
    private readonly custody;
    private readonly rpc;
    private readonly clock;
    private readonly claims;
    constructor(service: GuardedSwapService, materials: SavedOrcaStableMaterialStore, bindings: OrcaStableExecutionBindingStore, custody: Pick<ChainWalletStoragePort, "account" | "effectByOperationId">, rpc: SolanaRpc, clock?: () => Date);
    sendOnce(operationId: string): Promise<SwapOperationRecord>;
}
/** Production wiring for the one foreground-approved first attempt. */
export declare function executeOrcaStableFirstAttempt(input: {
    readonly service: GuardedSwapService;
    readonly materials: SavedOrcaStableMaterialStore;
    readonly bindings: OrcaStableExecutionBindingStore;
    readonly admission: OrcaStableAdmissionPorts;
    readonly custody: Pick<ChainWalletStoragePort, "account" | "withSeed" | "saveEffect" | "effect" | "effectByOperationId">;
    readonly rpc: SolanaRpc;
    readonly operationId: string;
    readonly clock?: () => Date;
    readonly verifyPins?: OrcaProgramPinVerifier;
}): Promise<{
    operation: SwapOperationRecord;
    binding: null;
    signature: null;
} | {
    operation: SwapOperationRecord;
    binding: OrcaStableExecutionBinding;
    signature: string;
}>;
export {};
