import { ApnError } from "../errors.js";
import type { OperationAbandonIntent } from "../operation-abandon-approval.js";
import { abandonTokenOperation } from "../operation-abandon-token.js";
import { STARGATE_TOKEN_TRANSITIONS, transition } from "./token-journal.js";
import type { StargateTokenJournal, StargateTokenOperation } from "./token-model.js";

/**
 * R4 exit 3 of a token Stargate journal (the shared token abandon): its deadline is the prepare expiry, after which no
 * new effect is signed; a pending ledger transition is settled by `apn stargate token status` first, so the abandoned
 * journal keeps a settled hold. Its consent names any signed approval, send or cleanup and the pool allowance.
 */
export async function abandonStargateV2Token(id: string, journal: StargateTokenJournal, approve: (intent: OperationAbandonIntent) => Promise<void>,
  now: () => number): Promise<StargateTokenOperation> {
  return await abandonTokenOperation(id, {
    noun: "Stargate token journal", missing: "Stargate token operation was not found.", changedReason: "stargate_token_abandon_changed",
    load: async () => await journal.load(id),
    terminal: op => STARGATE_TOKEN_TRANSITIONS[op.phase].length === 0,
    refusal: op => now() < Date.parse(op.expiresAt) || op.usageTarget !== undefined ? new ApnError("APN_OPERATION_BLOCKED",
      "Only a token Stargate journal past its prepare expiry, with no pending ledger step, can be abandoned.",
      { reason: "stargate_token_abandon_not_eligible", expiresAt: op.expiresAt }) : null,
    facts: op => ({ walletAddress: op.owner, recipient: op.recipient, amountAtomic: op.amountAtomic, chainLabel: "eip155:10",
      assetLabel: `USDC ${op.sourceToken}`, allowanceTo: "the Stargate pool",
      pending: [op.approvalTransactionHash, op.transactionHash, op.cleanupTransactionHash].filter(hash => hash !== undefined) }),
    withLock: async (op, work) => await journal.withOwnerLock(op.owner, async () => await journal.withLock(id, work)),
    close: async op => { const abandoned = transition(op, "abandoned_unknown", "owner_abandoned_unknown", now()); await journal.save(abandoned); return abandoned; },
  }, approve);
}
