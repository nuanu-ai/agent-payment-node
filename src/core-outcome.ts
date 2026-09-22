import { isPlainRecord } from "./canonical.js";
import type { CommandOutcome } from "./commands.js";

export function dataOutcome(data: unknown, fallbackProofClass: string): CommandOutcome {
  const artifact = artifactMetadata(data);
  return {
    proofClass: artifact.proofClass ?? fallbackProofClass,
    data,
    operation: null,
    receipt: null,
    nextActions: artifact.nextActions,
  };
}

export function operationOutcome(operation: unknown): CommandOutcome {
  const artifact = artifactMetadata(operation);
  return {
    proofClass: artifact.proofClass ?? "durable_public_state",
    data: null,
    operation,
    receipt: null,
    nextActions: artifact.nextActions,
  };
}

export function receiptOutcome(receipt: unknown): CommandOutcome {
  const artifact = artifactMetadata(receipt);
  return {
    proofClass: artifact.proofClass ?? "durable_public_state",
    data: null,
    operation: null,
    receipt,
    nextActions: artifact.nextActions,
  };
}

function artifactMetadata(value: unknown): { readonly proofClass?: string; readonly nextActions: readonly string[] } {
  const record = isPlainRecord(value) ? value : {};
  const proofClass = typeof record.proof_class === "string"
    ? record.proof_class
    : typeof record.proofClass === "string" ? record.proofClass : undefined;
  const actions = record.next_actions ?? record.nextActions;
  return {
    ...(proofClass === undefined ? {} : { proofClass }),
    nextActions: Array.isArray(actions) ? actions.filter((item): item is string => typeof item === "string") : [],
  };
}
