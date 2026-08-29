import type { CommandOutcome, CommandRequest, OutputEnvelope } from "./commands.js";
import { OUTPUT_VERSION } from "./constants.js";
import { asApnError } from "./errors.js";

export function successEnvelope(request: CommandRequest, requestId: string, outcome: CommandOutcome): OutputEnvelope {
  return {
    version: OUTPUT_VERSION,
    request_id: requestId,
    command: request.command,
    ok: true,
    proof_class: outcome.proofClass,
    data: outcome.data,
    operation: outcome.operation,
    receipt: outcome.receipt,
    error: null,
    next_actions: outcome.nextActions,
  };
}

export function failureEnvelope(command: string, requestId: string, error: unknown): OutputEnvelope {
  const safe = asApnError(error);
  return {
    version: OUTPUT_VERSION,
    request_id: requestId,
    command,
    ok: false,
    proof_class: "classified_failure",
    data: null,
    operation: null,
    receipt: null,
    error: {
      code: safe.code,
      message: safe.message,
      ...(safe.details === undefined ? {} : { details: safe.details }),
    },
    next_actions: nextActions(safe),
  };
}

function nextActions(error: ReturnType<typeof asApnError>): readonly string[] {
  switch (error.code) {
    case "APN_FOREGROUND_APPROVAL_REQUIRED": {
      const handoff = error.details?.cli_handoff;
      return typeof handoff === "string" ? [handoff] : [];
    }
    case "APN_NATIVE_CHANNEL_REQUIRED": return ["Initialize the local APN custody adapter."];
    case "APN_RPC_CONFIG": return ["Provide --rpc-url with an explicit HTTPS Base endpoint."];
    case "APN_REPREPARE_REQUIRED": return ["Prepare a new transfer with a new idempotency key."];
    case "APN_STATE_BUSY": return ["The kernel lock stayed busy through the bounded wait; retry after the active APN process exits. APN keeps stable lock files in place."];
    default: return [];
  }
}
