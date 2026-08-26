import { isPlainRecord } from "./canonical.js";
import type { CommandRequest, OutputEnvelope } from "./commands.js";
import { OUTPUT_VERSION } from "./constants.js";
import { asApnError } from "./errors.js";

export function successEnvelope(request: CommandRequest, requestId: string, result: unknown): OutputEnvelope {
  const record = isPlainRecord(result) ? result : {};
  const operation = isOperationCommand(request.command) ? result : null;
  const receipt = request.command === "receipt.get" ? result : null;
  return {
    version: OUTPUT_VERSION,
    request_id: requestId,
    command: request.command,
    ok: true,
    proof_class: typeof record.proof_class === "string" ? record.proof_class : proofClassFor(request.command),
    data: operation === null && receipt === null ? result : null,
    operation,
    receipt,
    error: null,
    next_actions: stringActions(record.next_actions),
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
    next_actions: nextActions(safe.code),
  };
}

function stringActions(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nextActions(code: string): readonly string[] {
  switch (code) {
    case "APN_NATIVE_CHANNEL_REQUIRED": return ["Run the command through APNKeychainAgent.app."];
    case "APN_RPC_CONFIG": return ["Provide --rpc-url with an explicit HTTPS Base endpoint."];
    case "APN_REPREPARE_REQUIRED": return ["Prepare a new transfer with a new idempotency key."];
    case "APN_STATE_BUSY": return ["Retry after the active APN operation exits."];
    default: return [];
  }
}

function isOperationCommand(command: CommandRequest["command"]): boolean {
  return ["transfer.prepare", "transfer.approve", "operation.status", "operation.resume"].includes(command);
}

function proofClassFor(command: CommandRequest["command"]): string {
  if (command === "version") return "local_build_metadata";
  if (command === "wallet.balance") return "chain_verified_public_read";
  if (["wallet.ensure", "wallet.status", "doctor.keychain"].includes(command)) return "native_keychain_status";
  return "durable_public_state";
}
