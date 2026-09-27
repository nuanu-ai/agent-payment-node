import { SwapOperationRepository } from "../repository.js";
import { type OrcaStableAdmissionPorts } from "./stable-admission.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
/** Local only: authenticated material and current owner admission, with no RPC, signer or sender. */
export declare function orcaStablePreparedStatus(operations: SwapOperationRepository, materialStore: SavedOrcaStableMaterialStore, ports: OrcaStableAdmissionPorts, operationId: string, now: Date): Promise<{
    schemaVersion: "apn.orca-stable-guarded-status.v1";
    operation: import("../model.js").SwapOperationRecord;
    quoteHash: string;
    materialDigest: string;
    messageHash: string;
    marketSlot: string;
    expiresAt: string;
    signable: false;
    executable: false;
    signed: false;
    broadcast: false;
}>;
