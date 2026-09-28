import type { ChainAccount, ChainWalletStoragePort, RailSignedEffect } from "../../direct-rail-ports.js";
import { SolanaRpc } from "../../solana/rpc.js";
import { GuardedSwapService } from "../service.js";
import type { SwapOperationRecord } from "../model.js";
import { OrcaStableExecutionBindingStore, type OrcaStableExecutionBinding } from "./stable-execution-journal.js";
import type { OrcaStableAdmissionPorts } from "./stable-admission.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
/** Signs the exact preflight message once. The caller owns the operation lock and persists the result before sending. */
export declare class OrcaStableLocalSigner {
    private readonly custody;
    constructor(custody: Pick<ChainWalletStoragePort, "withSeed">);
    sign(operation: SwapOperationRecord, binding: OrcaStableExecutionBinding, account: ChainAccount): Promise<RailSignedEffect>;
}
/** Recovery cannot release principal after a send right was consumed, even if custody is later unreadable. */
export declare function hasOrcaStableSendClaim(root: string, operation: SwapOperationRecord): Promise<boolean>;
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
/** Internal wiring for the first attempt. The public command remains closed pending the observation route. */
export declare function executeOrcaStableFirstAttempt(input: {
    readonly service: GuardedSwapService;
    readonly materials: SavedOrcaStableMaterialStore;
    readonly bindings: OrcaStableExecutionBindingStore;
    readonly admission: OrcaStableAdmissionPorts;
    readonly custody: Pick<ChainWalletStoragePort, "account" | "withSeed" | "saveEffect" | "effect" | "effectByOperationId">;
    readonly rpc: SolanaRpc;
    readonly operationId: string;
    readonly clock?: () => Date;
}): Promise<{
    operation: SwapOperationRecord;
    binding: null;
    signature: null;
} | {
    operation: SwapOperationRecord;
    binding: OrcaStableExecutionBinding;
    signature: string;
}>;
