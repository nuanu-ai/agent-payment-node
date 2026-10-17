import { hashObject } from "./canonical.js";
import type { CircleKnownOperation } from "./circle-v2-evm/funding-operation.js";

/** A Circle route of this account whose source burn is FINALIZED with zero residual allowance: it never signs on its
 * source chain again (cleanup and nonce retirement need an unburned source), only the mint on its destination. */
export function circleSourceSettled(op: CircleKnownOperation, profileHash: string, account: string): boolean {
  return op.profileHash === profileHash && op.sourceCustody.profileHash === profileHash && op.sourceCustody.walletAddress === account &&
    ["awaiting_mint", "mint_unknown", "awaiting_finality", "completed"].includes(op.state) && op.source?.finalityTag === "finalized" &&
    op.attestation !== null && op.residualAllowanceAtomic === "0" && op.effects.some(e => e.role === "approval") &&
    op.effects.some(e => e.role === "burn") && op.effects.filter(e => e.role !== "mint").every(e => e.phase === "confirmed" && e.proof !== null);
}
export function circleNativeSourceIdentity(op: CircleKnownOperation): string {
  return hashObject({ sourceCustody: op.sourceCustody, source: op.source, attestation: op.attestation,
    effects: op.effects.filter(e => e.role !== "mint"), residualAllowanceAtomic: op.residualAllowanceAtomic });
}
