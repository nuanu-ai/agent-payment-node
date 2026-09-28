import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { SolanaRpc } from "../../solana/rpc.js";
import { GuardedSwapService } from "../service.js";
import type { SwapOperationRecord } from "../model.js";
import { OrcaStableExecutionBindingStore } from "./stable-execution-journal.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
/** Internal observe-only route. Every entry reloads durable state under the sender's operation lock. */
export declare class OrcaStableFinalizedObserver {
    private readonly service;
    private readonly materials;
    private readonly bindings;
    private readonly custody;
    private readonly rpc;
    private readonly clock;
    private readonly observations;
    constructor(service: GuardedSwapService, materials: SavedOrcaStableMaterialStore, bindings: OrcaStableExecutionBindingStore, custody: Pick<ChainWalletStoragePort, "account" | "effectByOperationId">, rpc: SolanaRpc, clock?: () => Date);
    observe(operationId: string): Promise<SwapOperationRecord>;
    private replay;
    private now;
}
