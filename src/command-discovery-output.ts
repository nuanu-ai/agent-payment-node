import { randomUUID } from "node:crypto";
import type { OutputEnvelope } from "./commands.js";
import { OUTPUT_VERSION } from "./constants.js";
import type { ApnError } from "./errors.js";

export function usageFailureEnvelope(
  error: { readonly code: ApnError["code"]; readonly message: string },
  nextActions: readonly string[],
): OutputEnvelope {
  return {
    version: OUTPUT_VERSION,
    request_id: randomUUID(),
    command: "invalid",
    ok: false,
    proof_class: "classified_failure",
    data: null,
    operation: null,
    receipt: null,
    error,
    next_actions: nextActions,
  };
}
