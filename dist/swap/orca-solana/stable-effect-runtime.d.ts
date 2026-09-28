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
/** This port may be called only in the marker writer's lock, immediately after sealed effect persistence. */
export declare class OrcaStableSingleSender {
    private readonly rpc;
    private readonly custody;
    private readonly clock;
    constructor(rpc: SolanaRpc, custody: Pick<ChainWalletStoragePort, "effectByOperationId">, clock?: () => Date);
    sendOnce(operation: SwapOperationRecord, binding: OrcaStableExecutionBinding, account: ChainAccount, effect: RailSignedEffect): Promise<"submitted" | "possible_send">;
}
/** Internal wiring for the first attempt. The public command remains closed pending the observation route. */
export declare function executeOrcaStableFirstAttempt(input: {
    readonly service: GuardedSwapService;
    readonly materials: SavedOrcaStableMaterialStore;
    readonly bindings: OrcaStableExecutionBindingStore;
    readonly admission: OrcaStableAdmissionPorts;
    readonly custody: Pick<ChainWalletStoragePort, "withSeed" | "saveEffect" | "effect" | "effectByOperationId">;
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
