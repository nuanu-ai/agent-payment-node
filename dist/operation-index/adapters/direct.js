import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { StateStore } from "../../state.js";
import { publicOperation } from "../../transfer-policy.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageHash, salvageRecord, standardIdentity } from "../adapter.js";
import { providerClaims, UNREADABLE_PROVIDER_CLAIM } from "../types.js";
const STORE = { directory: "operations", perProfile: true };
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export function directDomains(record) {
    return [evmConflictDomain(record.chainId, record.walletAddress)];
}
/** A provider-direct operation also holds its provider account and payer, which span profiles. */
export function salvageProvider(providerId, accountBindingHash, payer) {
    try {
        if (typeof providerId !== "string" || !PROVIDER_ID.test(providerId) || typeof payer !== "string")
            throw new Error("doubtful");
        return providerClaims(providerId, salvageHash(accountBindingHash), salvageEvm(8453, payer).key.split(":")[2]);
    }
    catch {
        return [UNREADABLE_PROVIDER_CLAIM];
    }
}
export const directAdapter = {
    family: "direct_transfer",
    stores: [STORE],
    async load(root, recordPath) {
        const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
        return await new StateStore(root).loadOperation(profileHash, operationId);
    },
    identity: standardIdentity,
    claims: record => readableClaims(() => [
        ...domainClaims(directDomains(record)),
        ...(record.providerDirect === undefined ? [] : providerClaims(record.providerDirect.providerId, record.providerDirect.accountBindingHash, record.walletAddress)),
    ]),
    terminal: record => record.terminal,
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [
        salvageEvm(field(value, "chainId"), field(value, "walletAddress")),
        ...(field(value, "providerDirect") === undefined ? [] : salvageProvider(field(value, "providerDirect", "providerId"), field(value, "providerDirect", "accountBindingHash"), field(value, "walletAddress"))),
    ]),
    unknownClaims: [UNREADABLE_PROVIDER_CLAIM],
    view: async (record) => publicOperation(record),
};
//# sourceMappingURL=direct.js.map