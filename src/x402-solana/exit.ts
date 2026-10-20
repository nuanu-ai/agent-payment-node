import { ApnError } from "../errors.js";
import { followX402SolanaUsage } from "./admission.js";
import { transitionX402Solana, type X402SolanaRecord } from "./model.js";
import { X402SolanaRepository } from "./repository.js";

/**
 * The owner's exit for an exposed payment no proof decides yet (R4): after TTY consent it ends `abandoned_unknown` and the
 * price stays charged. A payment never exposed has proven exits instead (`x402 solana observe` once its window passes).
 */
export async function abandonX402Solana(root: string, operationId: string, now: () => Date,
  approve: (record: X402SolanaRecord) => Promise<void>): Promise<X402SolanaRecord> {
  const records = new X402SolanaRepository(root), record = await records.required(operationId);
  if (record.terminal) return record;
  if (record.state !== "exposed") {
    throw new ApnError("APN_OPERATION_BLOCKED", "Only an exposed Solana payment is abandoned; an unexposed one ends by observe once its window passes.",
      { reason: "x402_solana_not_exposed", nextActions: [`apn x402 solana observe --operation ${operationId}`] });
  }
  await approve(record);
  const next = await records.withLocks([`operation:${operationId}`], async () => {
    const current = await records.required(operationId);
    if (current.integrityHash !== record.integrityHash) throw new ApnError("APN_OPERATION_BLOCKED", "The Solana payment changed during the abandon decision.");
    return await records.persistLocked(transitionX402Solana(current, { state: "abandoned_unknown", at: now().toISOString(), reason: "owner_abandoned_unknown" }));
  });
  await followX402SolanaUsage(root, next, now());
  return next;
}
