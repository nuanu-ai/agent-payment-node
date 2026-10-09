import { hashObject } from "../canonical.js";
import { circleBlocked, type CircleEffect } from "./operation-model.js";
import { circleRecord, circleUint, verifyCircleObservation, type CircleObservation, type CircleReceiptProof } from "./protocol.js";
/** A canonical finalized revert has no burn or allowance grant and may enter explicit allowance cleanup. */
export function verifyCircleFinalizedRevert(effect: CircleEffect, observation: CircleObservation): CircleReceiptProof & { readonly outcome: "reverted" } {
  const receipt = circleRecord(observation.receipt), e = effect.envelope;
  if (observation.finalityTag !== "finalized" || observation.chainId !== 42161 || circleUint(receipt.status) !== 0n || !Array.isArray(receipt.logs) || receipt.logs.length !== 0) circleBlocked("revert_requires_finalized_empty_logs");
  // Reuse all receipt/block/recheck and transaction guards. Success status is the only normalized field.
  const proof = verifyCircleObservation({ ...observation, receipt: { ...receipt, status: "0x1" } }, { chain: e.chainId, from: e.from, to: e.to, data: e.data,
    transactionHash: effect.transactionHash!, maxNativeDebitAtomic: 30_000_000_000_000n, maxGasAtomic: BigInt(e.gasLimitAtomic) });
  return { ...proof, receiptHash: hashObject(receipt), outcome: "reverted" };
}
