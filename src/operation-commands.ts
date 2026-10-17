import type { CommandOutcome, CommandRequest } from "./commands.js";
import { operationOutcome } from "./core-outcome.js";
import { ApnError } from "./errors.js";
import { gaslessObservationRpcEnv } from "./gasless/observation-source.js";
import type { OperationFamilyAdapter, OperationResumeOptions } from "./operation-index/adapter.js";
import { OperationIndex } from "./operation-index/index.js";
import type { OperationIndexEntry } from "./operation-index/types.js";
import { pendingFamilyAbandon, pendingFamilyAnswer } from "./operation-pending-families.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalOperationId } from "./transfer-policy.js";

type ResumeRequest = Extract<CommandRequest, { readonly command: "operation.resume" }>;
interface Found { readonly entry: OperationIndexEntry; readonly adapter: OperationFamilyAdapter; readonly record: unknown }

/**
 * `apn operation status|resume|abandon` and `apn receipt get` for every family: one operation-index lookup, then the
 * family's adapter, which delegates to that family's own functions. There is no generic state machine here: a family
 * without a generic resume, receipt or owner exit answers with the command that is its exit. The owner exit of a record
 * that cannot be read (or of an admission whose prepare crashed) is the index's own release, behind TTY consent.
 */
export class OperationCommands {
  private readonly index: OperationIndex;
  constructor(private readonly context: RuntimeContext) { this.index = new OperationIndex(context.state); }

  async status(operationId: string): Promise<CommandOutcome> {
    const { adapter, record } = await this.found(operationId);
    return adapter.status !== undefined ? await adapter.status(this.context, record)
      : operationOutcome(await adapter.view(record, this.context.state.root));
  }

  async resume(request: ResumeRequest): Promise<CommandOutcome> {
    const { command: _command, operationId, ...options } = request;
    this.assertResumeOptions(options);
    const found = await this.found(operationId);
    if (found.adapter.resume === undefined) throw byFamilyCommand(found, "resume");
    return await found.adapter.resume(this.context, found.record, options);
  }

  async receipt(operationId: string): Promise<CommandOutcome> {
    const found = await this.found(operationId);
    if (found.adapter.receipt === undefined) {
      throw new ApnError("APN_RECEIPT_NOT_FOUND", `A ${found.entry.family} operation has no generic receipt; its evidence is in its own status.`,
        { operationId: found.entry.operationId, family: found.entry.family, nextActions: familyActions(found, "status") });
    }
    return await found.adapter.receipt(this.context, found.record);
  }

  async abandon(operationIdInput: string): Promise<CommandOutcome> {
    const operationId = canonicalOperationId(operationIdInput);
    await this.context.ready();
    let entry = await this.index.find(operationId);
    if (entry === null) return operationOutcome(await pendingFamilyAbandon(this.context, this.index.registry, operationId));
    let record: unknown;
    try { record = entry.unreadableReason === "duplicate_operation_id" ? undefined : await this.index.loadRecord(entry); }
    catch (error) {
      if (!(error instanceof ApnError)) throw error;
      record = undefined;
      // A record that became unreadable after it was indexed is quarantined first, so its release names the reason.
      if (entry.state === "active" || entry.state === "admitted") {
        await this.index.settle(operationId); entry = await this.index.find(operationId) ?? entry;
      }
    }
    // Already released and still unreadable: the answer is the release (asked once); a readable record takes its family's exit.
    if (record === undefined && entry.state === "released") return operationOutcome(publicRelease(entry));
    if (record === undefined || (record === null && entry.state === "admitted")) {
      return operationOutcome(publicRelease(await this.index.releaseByOwner(operationId, this.context.requireOperationAbandonApproval())));
    }
    const adapter = this.index.adapter(entry);
    if (record === null || adapter === undefined) throw notFound();
    if (adapter.abandon === undefined) throw byFamilyCommand({ entry, adapter, record }, "exit");
    return operationOutcome(await adapter.abandon(this.context, record));
  }

  /** The family's saved record behind an ID; an ID the index does not hold may belong to a family without an adapter yet. */
  private async found(operationIdInput: string): Promise<Found> {
    const operationId = canonicalOperationId(operationIdInput);
    await this.context.ready();
    const entry = await this.index.find(operationId);
    if (entry === null) return await pendingFamilyAnswer(this.context.state.root, this.index.registry, operationId);
    const adapter = this.index.adapter(entry);
    if (adapter === undefined) throw notFound();
    if (entry.unreadableReason === "duplicate_operation_id") {
      throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.", unreadableDetails(entry));
    }
    let record: unknown;
    try { record = await this.index.loadRecord(entry); }
    catch (error) {
      if (!(error instanceof ApnError)) throw error;
      throw new ApnError(error.code, error.message, { ...error.details, ...unreadableDetails(entry) });
    }
    if (record === null) {
      throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.", entry.state === "admitted" ? unreadableDetails(entry) : undefined);
    }
    return { entry, adapter, record };
  }

  /** The option combinations no family accepts, checked before any state is read (as before the index). */
  private assertResumeOptions(options: OperationResumeOptions): void {
    if (options.observeOnly !== undefined && options.observeOnly !== true) throw new ApnError("APN_INVALID_INPUT", "observeOnly must be true.");
    if (options.observeOnly && (options.waitSeconds !== undefined || options.observationRpcEnv !== undefined)) {
      throw new ApnError("APN_INVALID_INPUT", "Observation-only direct recovery cannot be combined with wait or gasless observation options.");
    }
    if (options.observationRpcEnv !== undefined) {
      gaslessObservationRpcEnv(options.observationRpcEnv);
      if (options.waitSeconds !== undefined || this.context.rpcUrl !== undefined) throw new ApnError("APN_INVALID_INPUT",
        "Observation RPC recovery cannot be combined with --rpc-url or --wait-seconds.", { reason: "gasless_observation_rpc_options" });
    }
  }
}

/** The owner release of an index entry whose record cannot be read; the record file and any ledger hold stay as they are. */
export const abandonCommand = (operationId: string) => `apn operation abandon --operation ${operationId}`;

function unreadableDetails(entry: OperationIndexEntry): Readonly<Record<string, string | readonly string[]>> {
  return { operationId: entry.operationId, family: entry.family, recordPath: entry.recordPath,
    ...(entry.state === "released" ? { indexState: "released" } : { nextActions: [abandonCommand(entry.operationId)] }) };
}

function publicRelease(entry: OperationIndexEntry) {
  return { operation_id: entry.operationId, family: entry.family, state: "released", record_path: entry.recordPath,
    reason: entry.state === "admitted" ? "admission_without_record" : entry.unreadableReason ?? "record_invalid",
    proof_class: "owner_acknowledgement_only", claims_released: true, record_unchanged: true, ledger_unchanged: true, next_actions: [] };
}

function familyActions(found: Found, use: "status" | "resume" | "exit"): readonly string[] {
  const commands = found.adapter.commands, id = found.entry.operationId;
  const template = use === "exit" ? commands?.exit ?? commands?.resume ?? commands?.status
    : use === "resume" ? commands?.resume ?? commands?.status : commands?.status;
  return template === undefined ? [] : [template.replaceAll("<operation-id>", id)];
}

/** A family whose recovery or exit is its own command: blocked, with that command as the next action. */
function byFamilyCommand(found: Found, use: "resume" | "exit"): ApnError {
  return new ApnError("APN_OPERATION_BLOCKED", use === "resume"
    ? `A ${found.entry.family} operation is advanced by its own command, not by operation resume.`
    : `A ${found.entry.family} operation has no owner abandon; its own command is its exit.`,
  { operationId: found.entry.operationId, family: found.entry.family,
    reason: use === "resume" ? "operation_resume_by_family_command" : "operation_exit_by_family_command", nextActions: familyActions(found, use) });
}

function notFound(): ApnError { return new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found."); }
