import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { GuardedSwapService } from "../../swap/service.js";
import { OrcaStableExecutionBindingStore } from "./execution-binding.js";
import { SavedOrcaStableMaterialStore } from "./material.js";
import { OrcaStableNoSendProofStore } from "./no-send-proof.js";
/**
 * Frozen local-only recovery of a stable operation a released version marked but never signed or claimed. It takes the
 * operation lock the released marker writer and sender held, and never signs, saves an effect or sends.
 */
export declare function recoverOrcaStableNoSend(service: GuardedSwapService, materials: SavedOrcaStableMaterialStore, bindings: OrcaStableExecutionBindingStore, proofs: OrcaStableNoSendProofStore, custody: Pick<ChainWalletStoragePort, "effectByOperationId">, localAccount: (profile: string) => ReturnType<ChainWalletStoragePort["account"]>, operationId: string, now: Date): Promise<import("../../core-exports.js").SwapOperationRecord>;
