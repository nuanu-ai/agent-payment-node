import { hashObject } from "../canonical.js";
import { circleBlocked, circleEnvelope, validateCircleEnvelope, type CircleOperationV1, type CircleEnvelope } from "./operation-model.js";
/** One retained Sei operation only; this does not admit new routes or nonce retries. */
export const SEALED_BURN_OPERATION = "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
export const SEALED_BURN_HASH = "0x8d3f33d87653d0413aab7faee5b7884f0fc42a5e1dc7d08ba5cb75c72cc3d541";
export const SEALED_BURN_MATERIAL = "88158eafdfa699730e0d5e800ab974d7fad9a87db88772ce67591cceca7f165a";
export function isSealedBurnRetirement(op: CircleOperationV1): boolean { return op.operationId === SEALED_BURN_OPERATION; }
export function assertSealedBurnRetirement(op: CircleOperationV1): void {
  assertBurnRetirementIdentity(op, "40000000");
}
export function assertConsumedBurnIdentity(op: CircleOperationV1): void {
  assertBurnRetirementIdentity(op, "40040000");
  if (op.effects[0]!.envelope.envelopeHash !== "0962c3adcb8f62eaf5c6f888ef7e2d34589d2d1103c99d3e133bcc47b464264d" || op.effects[1]!.envelope.envelopeHash !== "4eaddbcafbfbad48b0c72d9aa2d5ed959d3bc8985d87de7ddb3981f8fa6dfc79") circleBlocked("consumed_burn_original_envelope_changed");
}
export function isConsumedBurnRetirement(op: CircleOperationV1): boolean { return isSealedBurnRetirement(op) && op.effects[1]?.envelope.maxFeePerGasAtomic === "40040000"; }
function assertBurnRetirementIdentity(op: CircleOperationV1, maxFee: string): void {
  const a = op.effects[0]!, b = op.effects[1]!;
  if (!isSealedBurnRetirement(op) || op.destinationChain !== 1329 || op.destinationProfile !== "evm-live-seller" ||
    a.phase !== "confirmed" || a.transactionHash !== "0x26c833d2146ab758511354ff773fa7f0aece6de36bf433a022cc2ef6c74ae39a" || a.materialHash !== "737a7562b8152338cbeb7319e2c2e3a69985ea5b9fc7a16d090b86b12135f100" ||
    a.envelope.nonceAtomic !== "83" || a.proof === null || a.proof.actualFeeAtomic !== "1116903336000" ||
    b.phase !== "unknown" || b.transactionHash !== SEALED_BURN_HASH || b.materialHash !== SEALED_BURN_MATERIAL || b.proof !== null || b.envelope.nonceAtomic !== "84" || b.envelope.gasLimitAtomic !== "600000" || b.envelope.maxFeePerGasAtomic !== maxFee || b.envelope.maxPriorityFeePerGasAtomic !== "0" ||
    op.source !== null || op.attestation !== null || op.destination !== null || op.effects.some(e => e.role === "mint") || op.usage.length !== 5 ||
    !op.transitions.some(t => t.reason === "burn_material_sealed") || op.transitions.some(t => /^burn_(?:submission|submitted)/u.test(t.reason))) circleBlocked("exact_sealed_sei_burn_retirement_required");
}
export function sealedBurnBinding(op: CircleOperationV1): string {
  return hashObject({ version: "sealed-burn.v1", operationId: op.operationId, fingerprint: op.fingerprint, sourceCustody: op.sourceCustody,
    destinationCustody: op.destinationCustody, policies: op.policies, deploymentDigest: op.deploymentDigest, expiresAt: op.expiresAt,
    effects: op.effects.slice(0, 2).map(e => ({ envelope: e.envelope, transactionHash: e.transactionHash, materialHash: e.materialHash, proof: e.proof })) });
}
const bump = (n: bigint) => (n * 9n + 7n) / 8n;
export function sealedBurnReplacement(op: CircleOperationV1, quoted: CircleEnvelope, minimumTip: bigint): CircleEnvelope {
  assertSealedBurnRetirement(op); const old = op.effects[1]!.envelope, tip = [1n, minimumTip, bump(BigInt(old.maxPriorityFeePerGasAtomic))].reduce((a, b) => a > b ? a : b);
  const maxFee = [50000000n, bump(BigInt(old.maxFeePerGasAtomic)), BigInt(quoted.maxFeePerGasAtomic) + tip].reduce((a, b) => a > b ? a : b);
  const { envelopeHash: _hash, ...body } = quoted, result = circleEnvelope({ ...body, nonceAtomic: old.nonceAtomic, maxPriorityFeePerGasAtomic: tip.toString(), maxFeePerGasAtomic: maxFee.toString() });
  validateCircleEnvelope(result, "cleanup", op.destinationChain, null, op.destinationProfile); assertSealedBurnReplacement(op, result); return result;
}
export function assertSealedBurnReplacement(op: CircleOperationV1, e: CircleEnvelope): void {
  const old = op.effects[1]!.envelope;
  if (e.nonceAtomic !== "84" || BigInt(e.maxFeePerGasAtomic) < 50000000n || BigInt(e.maxFeePerGasAtomic) < bump(BigInt(old.maxFeePerGasAtomic)) ||
    BigInt(e.maxPriorityFeePerGasAtomic) < 1n || BigInt(e.maxPriorityFeePerGasAtomic) < bump(BigInt(old.maxPriorityFeePerGasAtomic))) circleBlocked("sealed_burn_replacement_fee_or_nonce");
}
