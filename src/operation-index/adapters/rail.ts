import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { ApnError } from "../../errors.js";
import { abandonRailTransfer } from "../../operation-abandon-service.js";
import { assertResumeOptions } from "../../operation-command-options.js";
import { railConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { publicRailOperation, RAIL_TERMINAL_STATES, railNextActions, type RailOperationRecord, type RailState } from "../../rail-operation-model.js";
import { RailOperationRepository } from "../../rail-operation-repository.js";
import { RailOperationService } from "../../rail-operation-service.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageRail, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";

const STORE: OperationStore = { directory: "rail-operations", perProfile: true };

/** Plain resume may send the approved transfer for the first time from these states (RailOperationService.resumeOperation). */
const FIRST_SEND_STATES: readonly RailState[] = ["signing_started", "signed_not_submitted"];
/** From these the transfer may already be broadcast: plain resume only observes it and never sends it again. */
const MAYBE_BROADCAST_STATES: readonly RailState[] = ["submitting", "submitted_pending", "unknown_finality"];

/** --observe-only exists only for local EVM direct transfers; the refusal names a command that never sends from this state. */
function refuseRailObserveOnly(record: RailOperationRecord, rail: string): never {
  const resume = `apn operation resume --operation ${record.operationId}`, status = `apn operation status --operation ${record.operationId}`;
  const prefix = `--observe-only is for local EVM direct transfers. This ${rail} transfer`;
  const refuse = (message: string, nextActions: readonly string[]): never => {
    throw new ApnError("APN_INVALID_INPUT", `${prefix} ${message}`, { reason: "rail_observe_only_unsupported", state: record.state, nextActions });
  };
  if (MAYBE_BROADCAST_STATES.includes(record.state)) refuse(`may already be broadcast: ${resume} only observes it and never sends it again.`, railNextActions(record));
  if (FIRST_SEND_STATES.includes(record.state)) {
    refuse(`is approved but was never sent: ${resume} would send it for the first time while it is still valid. Read it with ${status}.`, [status]);
  }
  return refuse(`has nothing to observe (${record.state}). Read it with ${status}.`, [status]);
}

export function railDomains(record: RailOperationRecord): readonly MoneyConflictDomain[] {
  return [railConflictDomain(record.account.rail, record.account.address)];
}

export const railAdapter: OperationFamilyAdapter<RailOperationRecord> = {
  family: "rail_transfer",
  stores: [STORE],
  async load(root, recordPath) {
    const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
    return await new RailOperationRepository(root).loadOperation(profileHash!, operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => domainClaims(railDomains(record))),
  terminal: record => RAIL_TERMINAL_STATES.includes(record.state),
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageRail(field(value, "account", "rail"), field(value, "account", "address"))]),
  view: async record => publicRailOperation(record),
  async resume(context, record, options) {
    const rail = record.account.rail === "tron" ? "TRON" : "Solana";
    assertResumeOptions(options, {
      refuseWait: () => { throw new ApnError("APN_INVALID_INPUT", `${rail} resume performs one bounded observation; omit --wait-seconds.`); },
      refuseObserveOnly: () => refuseRailObserveOnly(record, rail),
    });
    return operationOutcome(await new RailOperationService(context).resume(record.operationId));
  },
  receipt: async (context, record) => receiptOutcome(await new RailOperationService(context).receipt(record.operationId)),
  abandon: async (context, record) => await abandonRailTransfer(context, new RailOperationService(context), record),
};
