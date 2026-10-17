import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { isLegacyBridgeOperation, type StoredBridgeOperationRecord } from "../../lifi/legacy-operation.js";
import { BRIDGE_TERMINAL } from "../../lifi/operation-model.js";
import { BridgeOperationRepository } from "../../lifi/operation-repository.js";
import { publicStoredBridgeOperation } from "../../lifi/receipt.js";
import { BridgeService } from "../../lifi/service.js";
import { assertResumeOptions, oneObservationOnly } from "../../operation-command-options.js";
import { bridgeConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageBridge, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";

const STORE: OperationStore = { directory: "bridge-operations", perProfile: true };

export function bridgeDomains(record: StoredBridgeOperationRecord): readonly MoneyConflictDomain[] {
  return [bridgeConflictDomain(record.intent.sourceDeployment.chainId, record.intent.owner.address)];
}

/**
 * Current and legacy (widen-only) bridge journals, through the repository's version-aware reader. A legacy journal is
 * frozen (resume refuses it, nothing signs for it again), so it holds only its account, not its profile: only a
 * transaction it already sent may still land on that account.
 */
export const bridgeAdapter: OperationFamilyAdapter<StoredBridgeOperationRecord> = {
  family: "bridge_route",
  stores: [STORE],
  async load(root, recordPath) {
    const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
    return await new BridgeOperationRepository(root).loadStoredOperation(profileHash!, operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => domainClaims(bridgeDomains(record))),
  holdsProfile: record => !isLegacyBridgeOperation(record),
  // The family's outcome list, which its validator (current and legacy) ties the record's `terminal` flag to.
  terminal: record => BRIDGE_TERMINAL.includes(record.state),
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageBridge(field(value, "intent", "sourceDeployment", "chainId"),
    field(value, "intent", "owner", "address"))]),
  view: async record => publicStoredBridgeOperation(record),
  async resume(context, record, options) {
    assertResumeOptions(options, { refuseWait: () => oneObservationOnly("Bridge") });
    return operationOutcome(await new BridgeService(context).resume(record.operationId));
  },
  receipt: async (context, record) => receiptOutcome(await new BridgeService(context).receipt(record.operationId)),
  // No owner abandon: resume proves the outcome, including a source effect that can no longer land.
  commands: { status: "apn operation status --operation <operation-id>", exit: "apn operation resume --operation <operation-id>" },
};
