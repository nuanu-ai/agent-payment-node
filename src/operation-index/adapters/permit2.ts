import { evmConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { Permit2ProductionRepository, publicPermit2Production, type Permit2ProductionRecord } from "../../x402-permit2/production-repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";

const STORE: OperationStore = { directory: "permit2-production", perProfile: false };

export function permit2Domains(record: Permit2ProductionRecord): readonly MoneyConflictDomain[] {
  return [evmConflictDomain(43114, record.material.wallet.account)];
}

export const permit2Adapter: OperationFamilyAdapter<Permit2ProductionRecord> = {
  family: "permit2_production",
  stores: [STORE],
  async load(root, recordPath) {
    return await new Permit2ProductionRepository(root).findOperation(requiredRecordPath(recordPath, STORE).operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => domainClaims(permit2Domains(record))),
  terminal: record => record.terminal,
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageEvm(43114, field(value, "material", "wallet", "account"))]),
  view: async record => publicPermit2Production(record),
};
