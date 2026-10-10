import { type CircleEffect } from "./operation-model.js";
import { type CircleObservation, type CircleReceiptProof } from "./protocol.js";
/** A canonical finalized revert has no burn or allowance grant and may enter explicit allowance cleanup. */
export declare function verifyCircleFinalizedRevert(effect: CircleEffect, observation: CircleObservation): CircleReceiptProof & {
    readonly outcome: "reverted";
};
