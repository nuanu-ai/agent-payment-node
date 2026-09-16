import type { MetaMaskGaslessDispatch, MetaMaskGaslessIntent, MetaMaskGaslessQuote } from "./model.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";

/** Either the prepared material or the material the guard repriced inside the owner's maximum. */
export type MetaMaskGaslessDispatched = Pick<MetaMaskGaslessOperationRecord, "intent" | "dispatch">;

/**
 * The single seam between the prepared offer and the batch actually sent. The prepared intent is immutable, so the
 * approved fingerprint never moves; a reprice replaces only the quote and the delegation derived from it.
 */
export function mmDispatchIntent(op: MetaMaskGaslessDispatched): MetaMaskGaslessIntent {
  const dispatch: MetaMaskGaslessDispatch | null | undefined = op.dispatch;
  return dispatch === null || dispatch === undefined ? op.intent : { ...op.intent, ...dispatch };
}

/** The quote every post-dispatch proof must match: delivered, fee and debit are read against this one. */
export function mmDispatchedQuote(op: MetaMaskGaslessDispatched): MetaMaskGaslessQuote {
  return mmDispatchIntent(op).quote;
}
