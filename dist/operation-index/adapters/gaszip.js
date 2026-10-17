import { GaszipFundingJournal, publicGaszipFunding } from "../../lifi/gaszip-direct-journal.js";
import { GASZIP_DIRECT_ROUTES } from "../../lifi/gaszip-direct-route.js";
import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
/** Sei funding pays on Base and lands on Sei, so it holds the owner on both chains; Mega funding holds Base. */
export const seiGaszipDomains = (record) => [evmConflictDomain(8453, record.owner.address), evmConflictDomain(1329, record.owner.address)];
export const megaGaszipDomains = (record) => [evmConflictDomain(8453, record.owner.address)];
function gaszipAdapter(lane, domains) {
    // The route table is read only when used, so an import cycle through the adapters never meets it uninitialized.
    const route = () => GASZIP_DIRECT_ROUTES[lane], store = { directory: `${lane}-gaszip`, perProfile: false };
    const chains = lane === "sei" ? [8453, 1329] : [8453];
    return {
        family: lane === "sei" ? "sei_gaszip" : "mega_gaszip",
        stores: [store],
        async load(root, recordPath) {
            return await new GaszipFundingJournal(root, route()).findOperation(requiredRecordPath(recordPath, store).operationId);
        },
        identity: standardIdentity,
        claims: record => readableClaims(() => domainClaims(domains(record))),
        terminal: record => record.terminal,
        state: record => record.state,
        salvage: raw => salvageRecord(raw, value => chains.map(chain => salvageEvm(chain, field(value, "owner", "address")))),
        view: async (record) => publicGaszipFunding(route(), record),
        // Funding status observes the safe source and the correlated destination; there is no owner abandon.
        commands: { status: `apn ${lane} funding status --operation <operation-id>`, resume: `apn ${lane} funding status --operation <operation-id>` },
    };
}
export const seiGaszipAdapter = gaszipAdapter("sei", seiGaszipDomains);
export const megaGaszipAdapter = gaszipAdapter("mega", megaGaszipDomains);
//# sourceMappingURL=gaszip.js.map