import { randomUUID } from "node:crypto";
import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import { ApnError, asApnError } from "../errors.js";
import { refreshOperationIndex } from "../operation-index/refresh.js";
import { failureEnvelope, successEnvelope } from "../output.js";
import { asRateLimited } from "../rpc-rate-limit.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
import type { X402SolanaRecord } from "./model.js";
import { x402SolanaPorts } from "./runtime.js";
import { X402SolanaService } from "./service.js";
import { publicX402Solana } from "./view.js";

/** `apn x402 solana pay|observe|status`, CLI and MCP alike: `pay` runs unattended under the owner's Solana x402 policy. */
export async function executeX402SolanaCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope> {
  const request = bound.request, requestId = randomUUID();
  let operationId: string | undefined;
  try {
    if (request.command !== "x402.solana.pay" && request.command !== "x402.solana.observe" && request.command !== "x402.solana.status") {
      throw new ApnError("APN_UNSUPPORTED_COMMAND", "Solana x402 command is unavailable.");
    }
    const service = new X402SolanaService(root, x402SolanaPorts(root, options));
    let record: X402SolanaRecord, pending: string | null = null;
    if (request.command === "x402.solana.status") record = await service.records.required(request.operationId);
    else if (request.command === "x402.solana.observe") {
      operationId = request.operationId;
      ({ record, pending } = await service.observe(request.operationId));
    }
    else {
      const { command: _command, ...input } = request as Extract<typeof request, { readonly command: "x402.solana.pay" }>;
      const prepared = await service.prepare(input);
      operationId = prepared.operationId;
      record = await service.pay(prepared.operationId);
    }
    const data = publicX402Solana(record, pending) as { readonly next_actions: readonly string[] };
    return successEnvelope(request, requestId, { proofClass: proofClass(record), data, operation: null, receipt: null, nextActions: data.next_actions });
  } catch (error) {
    // A payment that already has a record answers with it: the original error, the operation itself (its id, state and
    // exposure) and its own next actions, whose first is the no-send observe. After exposure (a seller HTTP error, a
    // transport error, a malformed response) the payment may well have landed; nothing here or in a replay sends again.
    if (operationId !== undefined) {
      try {
        const saved = await new X402SolanaService(root, x402SolanaPorts(root, options)).records.find(operationId);
        if (saved !== null && saved.state !== "prepared") {
          const operation = publicX402Solana(saved) as { readonly next_actions: readonly string[] };
          const classified = asApnError(asRateLimited(error));
          return { ...failureEnvelope(request.command, requestId, new ApnError(classified.code, classified.message,
            { ...classified.details, operation_id: saved.operationId, state: saved.state, exposed: saved.exposure !== null,
              nextActions: operation.next_actions })), operation };
        }
      } catch { /* The original refusal is answered. */ }
    }
    return failureEnvelope(request.command, requestId, error);
  } finally {
    if (operationId !== undefined) await refreshOperationIndex(root, operationId);
  }
}

function proofClass(record: X402SolanaRecord): string {
  switch (record.state) {
    case "settled": return "solana_finalized_exact_transfer";
    case "failed_onchain": return "solana_finalized_transaction_error";
    case "expired_unlanded": return "solana_finalized_lifetime_passed_signature_index_covered";
    case "failed_before_effect": return "solana_payment_never_exposed";
    case "abandoned_unknown": return "owner_acknowledgement_only";
    default: return "x402_solana_local_journal";
  }
}
