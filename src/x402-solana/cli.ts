import { randomUUID } from "node:crypto";
import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import { ApnError } from "../errors.js";
import { refreshOperationIndex } from "../operation-index/refresh.js";
import { failureEnvelope, successEnvelope } from "../output.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
import type { X402SolanaRecord } from "./model.js";
import { x402SolanaPorts } from "./runtime.js";
import { X402SolanaService } from "./service.js";
import { publicX402Solana } from "./view.js";

/** `apn x402 solana pay|observe|status`, CLI and MCP alike (MCP reaches `pay` only as a foreground handoff). */
export async function executeX402SolanaCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope> {
  const request = bound.request, requestId = randomUUID();
  let operationId: string | undefined;
  try {
    if (request.command !== "x402.solana.pay" && request.command !== "x402.solana.observe" && request.command !== "x402.solana.status") {
      throw new ApnError("APN_UNSUPPORTED_COMMAND", "Solana x402 command is unavailable.");
    }
    const service = new X402SolanaService(root, x402SolanaPorts(root, options, request.command === "x402.solana.pay"));
    let record: X402SolanaRecord, pending: string | null = null;
    if (request.command === "x402.solana.status") record = await service.records.required(request.operationId);
    else if (request.command === "x402.solana.observe") ({ record, pending } = await service.observe(request.operationId));
    else {
      const { command: _command, ...input } = request as Extract<typeof request, { readonly command: "x402.solana.pay" }>;
      const prepared = await service.prepare(input);
      operationId = prepared.operationId;
      record = await service.pay(prepared.operationId);
    }
    const data = publicX402Solana(record, pending) as { readonly next_actions: readonly string[] };
    return successEnvelope(request, requestId, { proofClass: proofClass(record), data, operation: null, receipt: null, nextActions: data.next_actions });
  } catch (error) {
    // A payment that already has a record answers with it, so a refusal after preparation still shows where it stands.
    if (operationId !== undefined) {
      try {
        const saved = await new X402SolanaService(root, x402SolanaPorts(root, options, false)).records.find(operationId);
        if (saved !== null && saved.state !== "prepared") {
          return failureEnvelope(request.command, requestId, error instanceof ApnError ? new ApnError(error.code, error.message,
            { ...error.details, operation_id: saved.operationId, state: saved.state }) : error);
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
