import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { Permit2ProductionRepository, publicPermit2Production } from "../../x402-permit2/production-repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
const STORE = { directory: "permit2-production", perProfile: false };
export function permit2Domains(record) {
    return [evmConflictDomain(43114, record.material.wallet.account)];
}
export const permit2Adapter = {
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
    view: async (record) => publicPermit2Production(record),
};
//# sourceMappingURL=permit2.js.map