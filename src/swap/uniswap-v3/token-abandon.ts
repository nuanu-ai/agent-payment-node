import { ApnError } from "../../errors.js";
import type { OperationAbandonIntent } from "../../operation-abandon-approval.js";
import { transitionUniswapToken, UNISWAP_TOKEN_TERMINAL_PHASES, UniswapTokenJournal, type UniswapTokenOperation } from "./token-operation.js";

/**
 * R4 exit 3, the last resort: the owner closes a token swap that no proof decided, once its route deadline passed (the
 * router refuses the swap after it), with TTY consent. The record becomes `abandoned_unknown` and the operation index
 * releases the account; the usage ledger stays as it is (charged). Nothing is signed: a signed approval or cleanup may
 * still land, and a residual allowance may remain, which the consent states.
 */
export async function abandonUniswapToken(root: string, operationId: string, approve: (intent: OperationAbandonIntent) => Promise<void>,
  now: () => Date): Promise<UniswapTokenOperation> {
  const journal = new UniswapTokenJournal(root), initial = await required(journal, operationId);
  if (initial.phase === "abandoned_unknown") return initial;
  eligible(initial, now());
  const pending = [initial.approvalAttempt, initial.swapAttempt, initial.cleanupAttempt].flatMap((row) => row?.transactionHash ?? []);
  await approve({ operationId, fingerprint: initial.integrityHash, profile: initial.profile, providerId: "local", walletAddress: initial.account,
    recipient: initial.route.recipient, amountAtomic: initial.route.amountIn, amountDecimal: initial.route.amountIn, chainLabel: "eip155:1",
    assetLabel: `token ${initial.route.inputToken}`, unit: "atomic units",
    outcomeNote: `Financial outcome: UNKNOWN (phase ${initial.phase}).${pending.length === 0 ? "" : ` Signed transaction(s) ${pending.join(", ")} may still land.`}` +
      ` An allowance to ${initial.route.router} may remain; the usage hold stays charged.` });
  return await journal.withLocks([`uniswap-token-runtime:${operationId}`], async () => {
    const current = await required(journal, operationId);
    if (current.phase === "abandoned_unknown") return current;
    if (current.integrityHash !== initial.integrityHash) {
      throw new ApnError("APN_STATE_BUSY", "The token swap changed while the abandonment was confirmed; run it again.", { reason: "uniswap_token_abandon_changed" });
    }
    return await journal.save(transitionUniswapToken(current, "abandoned_unknown", { cleanupReason: "owner_abandoned_unknown" }, now()));
  });
}

function eligible(op: UniswapTokenOperation, at: Date): void {
  if (UNISWAP_TOKEN_TERMINAL_PHASES.includes(op.phase)) {
    throw new ApnError("APN_OPERATION_BLOCKED", "The token swap is already terminal; there is nothing to abandon.", { reason: "operation_already_terminal" });
  }
  if (at.getTime() < op.route.deadline * 1000 || (op.cleanupEvidence ?? null) !== null) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Only a token swap past its route deadline whose outcome no proof decided can be abandoned.",
      { reason: "uniswap_token_abandon_not_eligible", deadline: new Date(op.route.deadline * 1000).toISOString() });
  }
}
async function required(journal: UniswapTokenJournal, operationId: string): Promise<UniswapTokenOperation> {
  const op = await journal.read(operationId);
  if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Uniswap token operation was not found.");
  return op;
}
