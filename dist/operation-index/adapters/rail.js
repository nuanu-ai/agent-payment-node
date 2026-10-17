import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { ApnError } from "../../errors.js";
import { abandonRailTransfer } from "../../operation-abandon-service.js";
import { assertResumeOptions } from "../../operation-command-options.js";
import { railConflictDomain } from "../../operation-conflict-domain.js";
import { publicRailOperation } from "../../rail-operation-model.js";
import { RailOperationRepository } from "../../rail-operation-repository.js";
import { RailOperationService } from "../../rail-operation-service.js";
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
    async resume(context, record, options) {
        assertResumeOptions(options, { refuseWait: () => {
                throw new ApnError("APN_INVALID_INPUT", "Solana resume performs one bounded observation; omit --wait-seconds.");
            } });
        return operationOutcome(await new RailOperationService(context).resume(record.operationId));
    },
    receipt: async (context, record) => receiptOutcome(await new RailOperationService(context).receipt(record.operationId)),
    abandon: async (context, record) => await abandonRailTransfer(context, new RailOperationService(context), record),
};
//# sourceMappingURL=rail.js.map