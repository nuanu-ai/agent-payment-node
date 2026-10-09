import { getAddress } from "viem";
import { hashObject } from "../canonical.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN } from "./catalog.js";
import { circleBlocked, type CircleEffect, type CircleOperationV1 } from "./operation-model.js";
import { circleHex, circleRecord, circleUint, verifyCircleApproval, type CircleReceiptProof } from "./protocol.js";
import type { CircleRpc } from "./rpc.js";
export interface SealedBurnEvidence { readonly approvalProof: CircleReceiptProof; readonly usdcBalanceAtomic: string; }
export function assertRetirementObservedEnvelope(effect: CircleEffect, input: unknown): void {
  const t = circleRecord(input), e = effect.envelope;
  if (circleHex(t.hash, 32) !== effect.transactionHash || circleUint(t.nonce).toString() !== e.nonceAtomic || circleUint(t.gas).toString() !== e.gasLimitAtomic ||
    circleUint(t.maxFeePerGas).toString() !== e.maxFeePerGasAtomic || circleUint(t.maxPriorityFeePerGas).toString() !== e.maxPriorityFeePerGasAtomic ||
    circleHex(t.input) !== e.data || getAddress(String(t.from)) !== e.from || getAddress(String(t.to)) !== e.to || circleUint(t.value) !== 0n || circleUint(t.chainId) !== BigInt(e.chainId)) circleBlocked("receipt_transaction_envelope_changed");
}
export function approvalReceiptIdentity(proof: CircleReceiptProof): string {
  const { finalityTag: _tag, finalityBlockHash: _head, finalityBlockNumberAtomic: _number, ...body } = proof; return hashObject(body);
}
export async function sealedBurnEvidence(source: CircleRpc, op: CircleOperationV1, allowance: (tag: string) => Promise<string>): Promise<SealedBurnEvidence> {
  const approval = op.effects[0]!, observation = await source.observation(approval.transactionHash!, "finalized");
  if (observation === null) circleBlocked("retirement_original_approval_not_finalized");
  assertRetirementObservedEnvelope(approval, observation.transaction);
  const receipt = circleRecord(observation.receipt), proof = verifyCircleApproval(observation, false, await allowance(String(receipt.blockNumber)));
  if (approval.proof === null || approvalReceiptIdentity(proof) !== approvalReceiptIdentity(approval.proof)) circleBlocked("retirement_original_approval_reorg");
  const baseline = String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], String(receipt.blockNumber)));
  if (BigInt(baseline) < 40100n || String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER])) !== baseline) circleBlocked("retirement_source_principal_changed");
  if (circleHex((await source.block(String(receipt.blockNumber))).hash, 32) !== proof.blockHash) circleBlocked("retirement_original_approval_reorg");
  return { approvalProof: proof, usdcBalanceAtomic: baseline };
}
/** Pending nonce85 is allowed solely when the exact retained burn84 is publicly pending. */
export async function assertBurnReplacementAccount(source: CircleRpc, op: CircleOperationV1, latest: string, pending: string): Promise<void> {
  if (circleUint(latest) !== 84n) circleBlocked("retirement_original_burn_nonce_consumed");
  const receipt = await source.call("eth_getTransactionReceipt", [op.effects[1]!.transactionHash]);
  if (receipt !== null) circleBlocked("retirement_original_burn_receipt_present");
  if (circleUint(pending) === 84n) return;
  if (circleUint(pending) !== 85n) circleBlocked("retirement_pending_nonce_changed");
  const transaction = await source.call("eth_getTransactionByHash", [op.effects[1]!.transactionHash]);
  if (transaction === null || circleRecord(transaction).blockHash !== null || circleRecord(transaction).blockNumber !== null) circleBlocked("retirement_pending_burn_identity_required");
  assertRetirementObservedEnvelope(op.effects[1]!, transaction);
}
