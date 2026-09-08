import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { OperationRecord } from "./model.js";
import { validateOperation } from "./state-integrity.js";

export function validateEvmOperationWrite(next: OperationRecord, previousValue: unknown): void {
  if (next.evm === undefined && (previousValue === null || typeof previousValue !== "object" || !("evm" in previousValue))) return;
  validateOperation(next);
  if (previousValue === null) {
    if (next.state !== "awaiting_approval" || next.transitions.length !== 1) corrupt();
    return;
  }
  const previous = validateOperation(previousValue);
  if (previous.evm === undefined || next.evm === undefined || previous.fingerprint !== next.fingerprint ||
      previous.requestHash !== next.requestHash || previous.operationId !== next.operationId || previous.profileHash !== next.profileHash ||
      previous.idempotencyHash !== next.idempotencyHash || previous.preparedBlockNumberAtomic !== next.preparedBlockNumberAtomic ||
      (previous.transactionHash !== undefined && (previous.transactionHash !== next.transactionHash || previous.rawTransactionHash !== next.rawTransactionHash)) ||
      next.transitions.length < previous.transitions.length ||
      canonicalJson(next.transitions.slice(0, previous.transitions.length)) !== canonicalJson(previous.transitions) ||
      (next.transitions.length === previous.transitions.length && previous.integrityHash !== next.integrityHash) ||
      (previous.terminal && previous.integrityHash !== next.integrityHash)) corrupt();
}

function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Generic direct operation cannot replace or rewind its frozen durable authority."); }
