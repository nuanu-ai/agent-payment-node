import { FacilitatorGaslessOperationRepository } from "../../facilitator-gasless/operation-repository.js";
import { publicFacilitatorOperation } from "../../facilitator-gasless/receipt.js";
import { GaslessOperationRepository } from "../../gasless/operation-repository.js";
import { publicGaslessOperation } from "../../gasless/receipt.js";
import { MetaMaskGaslessOperationRepository } from "../../metamask-gasless/journal/repository.js";
import { publicMetaMaskGaslessOperation } from "../../metamask-gasless/journal/receipt.js";
import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { SmartAccountGaslessOperationRepository } from "../../smart-account-gasless/operation-repository.js";
import { publicSmartAccountGaslessOperation } from "../../smart-account-gasless/receipt.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
/** The four gasless journals differ only in their directory, reader, signing-owner field and public projection. */
function gaslessAdapter(family, directory, load, domains, ownerPath, view) {
    const store = { directory, perProfile: true };
    return {
        family,
        stores: [store],
        async load(root, recordPath) {
            const { profileHash, operationId } = requiredRecordPath(recordPath, store);
            return await load(root, profileHash, operationId);
        },
        identity: standardIdentity,
        claims: record => readableClaims(() => domainClaims(domains(record))),
        terminal: record => record.terminal,
        state: record => record.state,
        salvage: raw => salvageRecord(raw, value => [salvageEvm(field(value, "intent", "request", "chainId"), field(value, "intent", ...ownerPath))]),
        view: async (record) => view(record),
    };
}
export const gaslessDomains = (record) => [evmConflictDomain(record.intent.request.chainId, record.intent.owner.address)];
export const metaMaskGaslessDomains = (record) => [evmConflictDomain(record.intent.request.chainId, record.intent.binding.address)];
export const smartAccountGaslessDomains = (record) => [evmConflictDomain(record.intent.request.chainId, record.intent.binding.ownerAddress)];
export const facilitatorGaslessDomains = (record) => [evmConflictDomain(record.intent.request.chainId, record.intent.owner.address)];
export const gaslessTransferAdapter = gaslessAdapter("gasless_transfer", "gasless-operations", async (root, profileHash, id) => await new GaslessOperationRepository(root).loadOperation(profileHash, id), gaslessDomains, ["owner", "address"], publicGaslessOperation);
export const metaMaskGaslessAdapter = gaslessAdapter("metamask_gasless_transfer", "metamask-gasless-operations", async (root, profileHash, id) => await new MetaMaskGaslessOperationRepository(root).loadOperation(profileHash, id), metaMaskGaslessDomains, ["binding", "address"], record => publicMetaMaskGaslessOperation(record));
export const smartAccountGaslessAdapter = gaslessAdapter("smart_account_gasless_transfer", "smart-account-gasless-operations", async (root, profileHash, id) => await new SmartAccountGaslessOperationRepository(root).loadOperation(profileHash, id), smartAccountGaslessDomains, ["binding", "ownerAddress"], publicSmartAccountGaslessOperation);
export const facilitatorGaslessAdapter = gaslessAdapter("facilitator_gasless_transfer", "facilitator-gasless-operations", async (root, profileHash, id) => await new FacilitatorGaslessOperationRepository(root).loadOperation(profileHash, id), facilitatorGaslessDomains, ["owner", "address"], publicFacilitatorOperation);
//# sourceMappingURL=gasless.js.map