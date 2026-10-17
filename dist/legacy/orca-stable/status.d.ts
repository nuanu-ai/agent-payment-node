import { SwapOperationRepository } from "../../swap/repository.js";
import { SavedOrcaStableMaterialStore } from "./material.js";
/**
 * Local status of a stable operation a released version prepared: authenticated material, no RPC, signer or sender.
 * An unsigned preparation whose quote window closed is released here; nothing can execute it any more (SWAP-10).
 */
export declare function orcaStablePreparedStatus(operations: SwapOperationRepository, materialStore: SavedOrcaStableMaterialStore, operationId: string, now: Date): Promise<{
    schemaVersion: "apn.orca-stable-guarded-status.v1";
    operation: import("../../core-exports.js").SwapOperationRecord;
    quoteHash: string;
    materialDigest: string;
    messageHash: string;
    marketSlot: string;
    expiresAt: string;
    phase: import("../../core-exports.js").SwapOperationState;
    signable: false;
    executable: false;
    executionRequiresForegroundConsent: false;
    signed: boolean | null;
    broadcast: boolean | null;
    possibleSend: boolean;
    observeOnly: boolean;
}>;
