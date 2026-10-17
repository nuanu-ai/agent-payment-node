import { evmConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { relaySourceTerminal } from "../../relay/lifecycle.js";
import { publicRelayUnsignedOperation, RelayRetirementRepository, RelayUnsignedOperationRepository,
  type RelayUnsignedOperation } from "../../relay-unsigned-operation.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";

const STORE: OperationStore = { directory: "relay-unsigned-operations", perProfile: true };

export function relayDomains(record: RelayUnsignedOperation): readonly MoneyConflictDomain[] {
  return [evmConflictDomain(record.sourceChainId, record.sourceAccount)];
}

/** The public view: a retirement or a proven source outcome ends this spend attempt (destination delivery is observed separately). */
export async function relayStatus(root: string, operation: RelayUnsignedOperation) {
  const retirement = await new RelayRetirementRepository(root).load(operation);
  const completion = retirement === null ? await relaySourceTerminal(root, operation) : null;
  return publicRelayUnsignedOperation(operation, retirement, completion);
}

/** The saved draft stays `prepared`; it stops holding its account once retired or once its source effect is final. */
export const relayAdapter: OperationFamilyAdapter<RelayUnsignedOperation> = {
  family: "relay_unsigned",
  stores: [STORE],
  async load(root, recordPath) {
    const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
    return await new RelayUnsignedOperationRepository(root).loadOperation(profileHash!, operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => domainClaims(relayDomains(record))),
  async terminal(record, root) {
    if (record.terminal || await new RelayRetirementRepository(root).load(record) !== null) return true;
    return await relaySourceTerminal(root, record) !== null;
  },
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageEvm(field(value, "sourceChainId"), field(value, "sourceAccount"))]),
  view: async (record, root) => await relayStatus(root, record),
  // Execution, observation and retirement of the unsigned draft are Relay's own commands.
  commands: { status: "apn relay status --profile <profile> --operation <operation-id>",
    resume: "apn relay observe --profile <profile> --operation <operation-id> --rpc-url <source-rpc>",
    exit: "apn relay retire --profile <profile> --operation <operation-id>" },
};
