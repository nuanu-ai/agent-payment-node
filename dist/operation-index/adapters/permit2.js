import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { PERMIT2_PRODUCTION_TERMINAL_STATES, Permit2ProductionRepository, publicPermit2Production } from "../../x402-permit2/production-repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
const STORE = { directory: "permit2-production", perProfile: false };
export function permit2Domains(record) {
    return [evmConflictDomain(43114, record.material.wallet.account)];
}
/**
 * The family's own outcomes end the claim. An authorization never exposed is ended by the family itself past its
 * deadline: `x402 permit2 observe` runs the expiry release (released_unsubmitted, its usage hold freed).
 */
export const permit2Adapter = {
    family: "permit2_production",
    stores: [STORE],
    async load(root, recordPath) {
        return await new Permit2ProductionRepository(root).findOperation(requiredRecordPath(recordPath, STORE).operationId);
    },
    identity: standardIdentity,
    claims: record => readableClaims(() => domainClaims(permit2Domains(record))),
    terminal: record => PERMIT2_PRODUCTION_TERMINAL_STATES.includes(record.state),
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(43114, field(value, "material", "wallet", "account"))]),
    view: async (record) => publicPermit2Production(record),
    // Observation, including the proof that an expired authorization was never used, runs on Permit2's own CLI path.
    commands: { status: "apn x402 permit2 status --profile <profile> --operation <operation-id>",
        resume: "apn x402 permit2 observe --operation <operation-id> --rpc-url <https-rpc>",
        exit: "apn x402 permit2 observe --operation <operation-id> --rpc-url <https-rpc> --expired-unused" },
};
//# sourceMappingURL=permit2.js.map