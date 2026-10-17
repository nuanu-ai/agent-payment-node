import { railConflictDomain } from "../../operation-conflict-domain.js";
import { publicRailOperation } from "../../rail-operation-model.js";
import { RailOperationRepository } from "../../rail-operation-repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageRail, salvageRecord, standardIdentity } from "../adapter.js";
const STORE = { directory: "rail-operations", perProfile: true };
export function railDomains(record) {
    return [railConflictDomain(record.account.rail, record.account.address)];
}
export const railAdapter = {
    family: "rail_transfer",
    stores: [STORE],
    async load(root, recordPath) {
        const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
        return await new RailOperationRepository(root).loadOperation(profileHash, operationId);
    },
    identity: standardIdentity,
    claims: record => readableClaims(() => domainClaims(railDomains(record))),
    terminal: record => record.terminal,
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [salvageRail(field(value, "account", "rail"), field(value, "account", "address"))]),
    view: async (record) => publicRailOperation(record),
};
//# sourceMappingURL=rail.js.map