import { randomUUID } from "node:crypto";
import { ApnError, asApnError } from "../errors.js";
import { refreshOperationIndex } from "../operation-index/refresh.js";
import { failureEnvelope, successEnvelope } from "../output.js";
import { asRateLimited } from "../rpc-rate-limit.js";
import { x402SolanaPorts } from "./runtime.js";
import { X402SolanaService } from "./service.js";
import { publicX402Solana } from "./view.js";
/** `apn x402 solana pay|observe|status`, CLI and MCP alike: `pay` runs unattended under the owner's Solana x402 policy. */
export async function executeX402SolanaCli(bound, options, root) {
    const request = bound.request, requestId = randomUUID();
    let operationId;
    try {
        if (request.command !== "x402.solana.pay" && request.command !== "x402.solana.observe" && request.command !== "x402.solana.status") {
            throw new ApnError("APN_UNSUPPORTED_COMMAND", "Solana x402 command is unavailable.");
        }
        const service = new X402SolanaService(root, x402SolanaPorts(root, options));
        let record, pending = null;
        if (request.command === "x402.solana.status")
            record = await service.records.required(request.operationId);
        else if (request.command === "x402.solana.observe") {
            operationId = request.operationId;
            ({ record, pending } = await service.observe(request.operationId));
        }
        else {
            const { command: _command, ...input } = request;
            const prepared = await service.prepare(input);
            operationId = prepared.operationId;
            record = await service.pay(prepared.operationId);
        }
        const data = publicX402Solana(record, pending);
        return successEnvelope(request, requestId, { proofClass: proofClass(record), data, operation: null, receipt: null, nextActions: data.next_actions });
    }
    catch (error) {
        // A payment that already has a record answers with it: the original error and the operation itself (its id, state,
        // signature and exposure). Before exposure nothing reached the seller: the error's own remedy leads when it has one,
        // else the payment's actions (a prepared payment holds its claim: the same-key pay, then the no-send observe; QA 0.5.65).
        // After exposure (a seller HTTP error, a transport error, a malformed response) the payment may well have landed; the
        // first action is the no-send observe and nothing here or in a replay sends again.
        try {
            // A failure after prepare saved the record (a derived-index write, QA 0.5.67) still names it: the key fixes the id.
            const service = new X402SolanaService(root, x402SolanaPorts(root, options));
            const id = operationId ?? (request.command === "x402.solana.pay" ? service.operationIdFor(request.profile, request.idempotencyKey) : undefined);
            const saved = id === undefined ? null : await service.records.find(id);
            if (saved !== null) {
                operationId = saved.operationId;
                const operation = publicX402Solana(saved);
                const classified = asApnError(asRateLimited(error)), own = failureEnvelope(request.command, requestId, classified).next_actions;
                const nextActions = saved.exposure === null && own.length > 0 ? own : operation.next_actions;
                return { ...failureEnvelope(request.command, requestId, new ApnError(classified.code, classified.message, { ...classified.details, operation_id: saved.operationId, state: saved.state, signed: saved.signed !== null,
                        exposed: saved.exposure !== null, nextActions })), operation };
            }
        }
        catch { /* The original refusal is answered. */ }
        return failureEnvelope(request.command, requestId, error);
    }
    finally {
        if (operationId !== undefined)
            await refreshOperationIndex(root, operationId);
    }
}
function proofClass(record) {
    switch (record.state) {
        case "settled": return "solana_finalized_exact_transfer";
        case "failed_onchain": return "solana_finalized_transaction_error";
        case "expired_unlanded": return "solana_finalized_lifetime_passed_signature_index_covered";
        case "failed_before_effect": return "solana_payment_never_exposed";
        case "abandoned_unknown": return "owner_acknowledgement_only";
        default: return "x402_solana_local_journal";
    }
}
//# sourceMappingURL=cli.js.map