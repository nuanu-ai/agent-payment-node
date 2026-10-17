import { type SwapOperationRecord, type SwapReceiptProof } from "../../swap/model.js";
import { type OrcaStableMaterial } from "./material.js";
import { type OrcaStableUnsignedPreview } from "./preview.js";
export type OrcaStableReceiptOutcome = {
    readonly outcome: "succeeded" | "reverted";
    readonly proof: SwapReceiptProof;
};
/** Pure verification for a future observation route. This does no RPC or state transition. */
export declare function verifyOrcaStableFinalizedReceipt(input: {
    readonly operation: SwapOperationRecord;
    readonly material: OrcaStableMaterial;
    readonly signature: string;
    readonly executionPreview?: OrcaStableUnsignedPreview;
    readonly signatureStatuses: unknown;
    readonly transaction: unknown;
    readonly observedAt: Date;
}): Promise<OrcaStableReceiptOutcome | null>;
