import { ApnError } from "../../errors.js";
import type { OperationAbandonIntent } from "../../operation-abandon-approval.js";
import { abandonTokenOperation } from "../../operation-abandon-token.js";
import { transitionUniswapToken, UNISWAP_TOKEN_TERMINAL_PHASES, UniswapTokenJournal, type UniswapTokenOperation } from "./token-operation.js";

/**
 * R4 exit 3 of a token swap (the shared token abandon): its deadline is the route deadline, after which the router
 * refuses the swap; a swap whose outcome a proof already decided (cleanup evidence) is not abandoned. Its consent names
 * any signed approval, swap or cleanup and the router allowance. The principal hold stays only while a swap of it could
 * still land: execute later releases it on custody's proof that the swap never signed (keeping gas and history).
 */
export async function abandonUniswapToken(root: string, operationId: string, approve: (intent: OperationAbandonIntent) => Promise<void>,
  now: () => Date): Promise<UniswapTokenOperation> {
  const journal = new UniswapTokenJournal(root);
  return await abandonTokenOperation(operationId, {
    noun: "token swap", missing: "Uniswap token operation was not found.", changedReason: "uniswap_token_abandon_changed",
    load: async () => await journal.read(operationId),
    terminal: op => UNISWAP_TOKEN_TERMINAL_PHASES.includes(op.phase),
    refusal: op => now().getTime() < op.route.deadline * 1000 || (op.cleanupEvidence ?? null) !== null ? new ApnError("APN_OPERATION_BLOCKED",
      "Only a token swap past its route deadline whose outcome no proof decided can be abandoned.",
      { reason: "uniswap_token_abandon_not_eligible", deadline: new Date(op.route.deadline * 1000).toISOString() }) : null,
    facts: op => ({ walletAddress: op.account, recipient: op.route.recipient, amountAtomic: op.route.amountIn, chainLabel: "eip155:1",
      assetLabel: `token ${op.route.inputToken}`, allowanceTo: op.route.router,
      pending: [op.approvalAttempt, op.swapAttempt, op.cleanupAttempt].flatMap(row => row?.transactionHash ?? []) }),
    withLock: async (_op, work) => await journal.withLocks([`uniswap-token-runtime:${operationId}`], work),
    close: async op => await journal.save(transitionUniswapToken(op, "abandoned_unknown", { cleanupReason: "owner_abandoned_unknown" }, now())),
  }, approve);
}
