import { GuardedSwapService } from "../service.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
/** Retires an unsigned stable preparation and its exact principal lease, including an orphan after a reserve crash. */
export declare function releaseOrcaStableNoEffect(service: GuardedSwapService, materialStore: SavedOrcaStableMaterialStore, operationId: string, now: Date): Promise<{
    schemaVersion: "apn.orca-stable-no-effect-release.v1";
    operation: import("../model.js").SwapOperationRecord;
    signable: false;
    executable: false;
    signed: false;
    broadcast: false;
}>;
