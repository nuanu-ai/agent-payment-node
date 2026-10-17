import { operationOutcome } from "./core-outcome.js";
import { ApnError } from "./errors.js";
import { gaslessObservationRpcEnv } from "./gasless/observation-source.js";
import { unexecutedUsdtPreparation } from "./operation-index/adapters/gasless-usdt.js";
import { OperationIndex } from "./operation-index/index.js";
import { StateStore } from "./state.js";
import { canonicalOperationId } from "./transfer-policy.js";
/**
 * `apn operation status|resume|abandon` and `apn receipt get` for every family: one operation-index lookup, then the
 * family's adapter, which delegates to that family's own functions. There is no generic state machine here: a family
 * without a generic resume, receipt or owner exit answers with the command that is its exit. The owner exit of a record
 * that cannot be read (or of an admission whose prepare crashed) is the index's own release, behind TTY consent.
 */
export class OperationCommands {
    context;
    index;
    constructor(context) {
        this.context = context;
        this.index = new OperationIndex(context.state);
    }
    async status(operationId) {
        const { adapter, record } = await this.found(operationId);
        return adapter.status !== undefined ? await adapter.status(this.context, record)
            : operationOutcome(await adapter.view(record, this.context.state.root));
    }
    async resume(request) {
        const { command: _command, operationId, ...options } = request;
        this.assertResumeOptions(options);
        const found = await this.found(operationId);
        if (found.adapter.resume === undefined)
            throw byFamilyCommand(found, "resume");
        return await found.adapter.resume(this.context, found.record, options);
    }
    async receipt(operationId) {
        const found = await this.found(operationId);
        if (found.adapter.receipt === undefined) {
            throw new ApnError("APN_RECEIPT_NOT_FOUND", `A ${found.entry.family} operation has no generic receipt; its evidence is in its own status.`, { operationId: found.entry.operationId, family: found.entry.family, nextActions: familyActions(found, "status") });
        }
        return await found.adapter.receipt(this.context, found.record);
    }
    async abandon(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        let entry = await this.index.find(operationId);
        if (entry === null)
            throw await this.notIndexed(operationId);
        let record;
        try {
            record = entry.unreadableReason === "duplicate_operation_id" ? undefined : await this.index.loadRecord(entry);
        }
        catch (error) {
            if (!(error instanceof ApnError))
                throw error;
            record = undefined;
            // A record that became unreadable after it was indexed is quarantined first, so its release names the reason.
            if (entry.state === "active" || entry.state === "admitted") {
                await this.index.settle(operationId);
                entry = await this.index.find(operationId) ?? entry;
            }
        }
        // Already released and still unreadable: the answer is the release (asked once); a readable record takes its family's exit.
        if (record === undefined && entry.state === "released")
            return operationOutcome(publicRelease(entry));
        if (record === undefined || (record === null && entry.state === "admitted")) {
            return operationOutcome(publicRelease(await this.index.releaseByOwner(operationId, this.context.requireOperationAbandonApproval())));
        }
        const adapter = this.index.adapter(entry);
        if (record === null || adapter === undefined)
            throw notFound();
        if (adapter.abandon === undefined)
            throw byFamilyCommand({ entry, adapter, record }, "exit");
        return operationOutcome(await adapter.abandon(this.context, record));
    }
    /** The family's saved record behind an ID; the index holds every family's operations. */
    async found(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const entry = await this.index.find(operationId);
        if (entry === null)
            throw await this.notIndexed(operationId);
        const adapter = this.index.adapter(entry);
        if (adapter === undefined)
            throw notFound();
        if (entry.unreadableReason === "duplicate_operation_id") {
            throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.", unreadableDetails(entry));
        }
        let record;
        try {
            record = await this.index.loadRecord(entry);
        }
        catch (error) {
            if (!(error instanceof ApnError))
                throw error;
            throw new ApnError(error.code, error.message, { ...error.details, ...unreadableDetails(entry) });
        }
        if (record === null) {
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.", entry.state === "admitted" ? unreadableDetails(entry) : undefined);
        }
        return { entry, adapter, record };
    }
    /** Every family's operations are indexed except a gasless USDT preparation that never executed, which has its own status. */
    async notIndexed(operationId) {
        return await unexecutedUsdtPreparation(this.context.state.root, operationId) ?? notFound();
    }
    /** The option combinations no family accepts, checked before any state is read (as before the index). */
    assertResumeOptions(options) {
        if (options.observeOnly !== undefined && options.observeOnly !== true)
            throw new ApnError("APN_INVALID_INPUT", "observeOnly must be true.");
        if (options.observeOnly && (options.waitSeconds !== undefined || options.observationRpcEnv !== undefined)) {
            throw new ApnError("APN_INVALID_INPUT", "Observation-only direct recovery cannot be combined with wait or gasless observation options.");
        }
        if (options.observationRpcEnv !== undefined) {
            gaslessObservationRpcEnv(options.observationRpcEnv);
            if (options.waitSeconds !== undefined || this.context.rpcUrl !== undefined)
                throw new ApnError("APN_INVALID_INPUT", "Observation RPC recovery cannot be combined with --rpc-url or --wait-seconds.", { reason: "gasless_observation_rpc_options" });
        }
    }
}
/** The generic commands that delegate to a family runtime; the owner exits (abandon) read only the state root. */
const DELEGATED = { "operation.status": "status", "operation.resume": "resume", "receipt.get": "receipt" };
/**
 * The family command whose runtime a generic operation command delegates to, read before that runtime is built: the
 * runtime factory builds a family runtime only for the commands that name it. Null for any other command, when the
 * family answers this one without its runtime, and when the lookup refuses (an unknown ID, an unreadable record): the
 * command repeats the same lookup and answers that refusal itself.
 */
export async function operationRuntimeCommand(root, request) {
    const method = DELEGATED[request.command];
    if (method === undefined)
        return null;
    try {
        const state = new StateStore(root);
        await state.initialize();
        const index = new OperationIndex(state), entry = await index.find(canonicalOperationId(request.operationId));
        const adapter = entry === null ? undefined : index.adapter(entry);
        if (entry === null || adapter?.runtimeCommand === undefined || adapter[method] === undefined)
            return null;
        const record = await index.loadRecord(entry);
        return record === null ? null : await adapter.runtimeCommand(record);
    }
    catch (error) {
        if (error instanceof ApnError)
            return null;
        throw error;
    }
}
/** The owner release of an index entry whose record cannot be read; the record file and any ledger hold stay as they are. */
export const abandonCommand = (operationId) => `apn operation abandon --operation ${operationId}`;
function unreadableDetails(entry) {
    return { operationId: entry.operationId, family: entry.family, recordPath: entry.recordPath,
        ...(entry.state === "released" ? { indexState: "released" } : { nextActions: [abandonCommand(entry.operationId)] }) };
}
function publicRelease(entry) {
    return { operation_id: entry.operationId, family: entry.family, state: "released", record_path: entry.recordPath,
        reason: entry.state === "admitted" ? "admission_without_record" : entry.unreadableReason ?? "record_invalid",
        proof_class: "owner_acknowledgement_only", claims_released: true, record_unchanged: true, ledger_unchanged: true, next_actions: [] };
}
function familyActions(found, use) {
    const commands = found.adapter.commands, id = found.entry.operationId;
    const template = use === "exit" ? commands?.exit ?? commands?.resume ?? commands?.status
        : use === "resume" ? commands?.resume ?? commands?.status : commands?.status;
    return template === undefined ? [] : [template.replaceAll("<operation-id>", id)];
}
/** A family whose recovery or exit is its own command: blocked, with that command as the next action. */
function byFamilyCommand(found, use) {
    return new ApnError("APN_OPERATION_BLOCKED", use === "resume"
        ? `A ${found.entry.family} operation is advanced by its own command, not by operation resume.`
        : `A ${found.entry.family} operation has no owner abandon; its own command is its exit.`, { operationId: found.entry.operationId, family: found.entry.family,
        reason: use === "resume" ? "operation_resume_by_family_command" : "operation_exit_by_family_command", nextActions: familyActions(found, use) });
}
function notFound() { return new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found."); }
//# sourceMappingURL=operation-commands.js.map