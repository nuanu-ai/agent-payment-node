import type { CommandOutcome, CommandRequest, OutputEnvelope } from "./commands.js";
import { OUTPUT_VERSION } from "./constants.js";
import { asApnError } from "./errors.js";
import { asRateLimited } from "./rpc-rate-limit.js";

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
  // A caller sees an HTTP 429 as a rate limit in every family, whichever transport first classified it.
  const safe = asApnError(asRateLimited(error));
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
  const explicit = error.details?.nextActions;
  if (Array.isArray(explicit) && explicit.every((value) => typeof value === "string")) return explicit;
  switch (error.code) {
    case "APN_FOREGROUND_AUTH_REQUIRED": {
      const handoff = error.details?.cli_handoff;
      return typeof handoff === "string" ? [handoff] : [];
    }
    case "APN_PROFILE_DRIFT": {
      const handoff = error.details?.cli_handoff;
      return typeof handoff === "string"
        ? [handoff]
        : ["Run the foreground wallet connect handoff with --expected-revision set to the current revision."];
    }
    case "APN_PROVIDER_SESSION_REQUIRED": return ["Run the foreground wallet connect handoff again."];
    case "APN_PROVIDER_UNAVAILABLE": return ["Verify the exact pinned provider client, then retry foreground wallet connect."];
    case "APN_PROVIDER_PROTOCOL": return ["Stop and verify the pinned provider client before retrying."];
    case "APN_PROVIDER_EFFECT_UNAVAILABLE": return ["Use a local profile for payment effects in this APN version."];
    case "APN_PROFILE_REVISION_CONFLICT": return ["Read current wallet status, then retry foreground connect with the exact current revision."];
    case "APN_FOREGROUND_APPROVAL_REQUIRED": {
      const handoff = error.details?.cli_handoff;
      return typeof handoff === "string" ? [handoff] : [];
    }
    case "APN_NATIVE_CHANNEL_REQUIRED": return ["Initialize the local APN custody adapter."];
    case "APN_RPC_CONFIG": {
      const names = rpcEnvironmentNames(error);
      return names.length > 0
        ? [`Set ${names.join(" and ")} to a public HTTPS RPC endpoint of that chain, then rerun the same command.`]
        : ["Correct the selected network's RPC setting named in the error (its --rpc-url or APN_*_RPC_URL), then retry."];
    }
    case "APN_RPC_RATE_LIMITED": return ["Wait for the RPC provider's rate-limit window, then rerun the same command; prepared operations are idempotent."];
    case "APN_REPREPARE_REQUIRED": return ["Prepare a new operation with a new idempotency key; this one can no longer proceed."];
    case "APN_STATE_BUSY": return ["The kernel lock stayed busy through the bounded wait; retry after the active APN process exits. APN keeps stable lock files in place."];
    case "APN_OPERATION_BLOCKED": {
      // A blocker whose record cannot be read has one exit: the owner releases its claims with TTY consent (the record
      // and any ledger hold stay as they are). The operation index raises it for every family.
      const blocker = error.details?.blockingOperationId;
      return error.details?.blockingReason === "blocking_record_unreadable" && typeof blocker === "string"
        ? [`apn operation status --operation ${blocker}`, `apn operation abandon --operation ${blocker}`] : [];
    }
    default: return [];
  }
}

/** The RPC environment variables an RPC configuration failure names in its message or reason, in order, once each. */
function rpcEnvironmentNames(error: ReturnType<typeof asApnError>): readonly string[] {
  const text = `${error.message} ${typeof error.details?.reason === "string" ? error.details.reason : ""}`;
  return [...new Set(text.match(/APN_[A-Z0-9_]+_RPC_URLS?/gu) ?? [])];
}
