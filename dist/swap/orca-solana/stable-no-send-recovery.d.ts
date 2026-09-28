import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { GuardedSwapService } from "../service.js";
import { OrcaStableExecutionBindingStore } from "./stable-execution-journal.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { OrcaStableNoSendProofStore } from "./stable-no-send-proof.js";
/**
 * Internal, local-only recovery. The operation lock is shared with the marker writer and must also guard any future
 * sender. A sender may proceed only for a nonterminal operation with a previously persisted and verified signed effect;
 * it must never sign, save an effect or send after this no-send proof exists.
 */
export declare function recoverOrcaStableNoSend(service: GuardedSwapService, materials: SavedOrcaStableMaterialStore, bindings: OrcaStableExecutionBindingStore, proofs: OrcaStableNoSendProofStore, custody: Pick<ChainWalletStoragePort, "effectByOperationId">, localAccount: (profile: string) => ReturnType<ChainWalletStoragePort["account"]>, operationId: string, now: Date): Promise<import("../model.js").SwapOperationRecord>;
