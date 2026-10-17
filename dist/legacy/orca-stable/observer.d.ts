import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { SolanaRpc } from "../../solana/rpc.js";
import { GuardedSwapService } from "../../swap/service.js";
import type { SwapOperationRecord } from "../../swap/model.js";
import { OrcaStableExecutionBindingStore } from "./execution-binding.js";
import { SavedOrcaStableMaterialStore } from "./material.js";
/**
 * Frozen observe-only finisher of stable operations a released version marked or sent (SWAP-10). Every entry reloads
 * durable state under the operation lock the released sender held. It never signs, sends or opens the wallet seed.
 */
export declare class OrcaStableFinalizedObserver {
    private readonly service;
    private readonly materials;
    private readonly bindings;
    private readonly custody;
    private readonly rpc;
    private readonly clock;
    private readonly observations;
    constructor(service: GuardedSwapService, materials: SavedOrcaStableMaterialStore, bindings: OrcaStableExecutionBindingStore, custody: Pick<ChainWalletStoragePort, "account">, rpc: SolanaRpc, clock?: () => Date);
    observe(operationId: string): Promise<SwapOperationRecord>;
    private replay;
    /**
     * A signed but never claimed effect (the process stopped between sealing the signature and the claim that precedes
     * transport) was never sent. Once the finalized height passes its bound lifetime it can never land: expired_unlanded
     * releases the principal. Before that the operation stays as it is; nothing is ever signed or sent here.
     */
    private expireUnclaimed;
    /** Finalized height past the bound lifetime and no status for the claimed signature (with history): it can never land. */
    private expireIfUnlanded;
    private verifyRpcSource;
    private now;
}
