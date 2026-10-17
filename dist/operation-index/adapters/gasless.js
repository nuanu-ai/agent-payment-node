import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { ApnError } from "../../errors.js";
import { facilitatorFail } from "../../facilitator-gasless/failure.js";
import { FacilitatorGaslessOperationRepository } from "../../facilitator-gasless/operation-repository.js";
import { publicFacilitatorOperation } from "../../facilitator-gasless/receipt.js";
import { FacilitatorGaslessService } from "../../facilitator-gasless/service.js";
import { GaslessOperationRepository } from "../../gasless/operation-repository.js";
import { publicGaslessOperation } from "../../gasless/receipt.js";
import { GaslessService } from "../../gasless/service.js";
import { MetaMaskGaslessOperationRepository } from "../../metamask-gasless/journal/repository.js";
import { publicMetaMaskGaslessOperation } from "../../metamask-gasless/journal/receipt.js";
import { MetaMaskGaslessService } from "../../metamask-gasless/service.js";
import { abandonFacilitatorGasless, abandonLocalGasless, abandonMetaMaskGasless } from "../../operation-abandon-gasless.js";
import { abandonSmartAccountGasless } from "../../operation-abandon-provider.js";
import { assertResumeOptions, oneObservationOnly } from "../../operation-command-options.js";
import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { SmartAccountGaslessOperationRepository } from "../../smart-account-gasless/operation-repository.js";
import { OperationService } from "../../operation-service.js";
import { saFail } from "../../smart-account-gasless/reasons.js";
import { publicSmartAccountGaslessOperation } from "../../smart-account-gasless/receipt.js";
import { SmartAccountGaslessService } from "../../smart-account-gasless/service.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
/** The four gasless journals differ only in their directory, reader, signing-owner field, public projection and service. */
function gaslessAdapter(family, directory, load, domains, ownerPath, view, commands) {
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
        status: async (context, record) => operationOutcome(await commands.status(context, record.operationId)),
        async resume(context, record, options) {
            assertResumeOptions(options, commands.resumeOptions);
            return operationOutcome(await commands.resume(context, record.operationId, options.observationRpcEnv));
        },
        receipt: async (context, record) => receiptOutcome(await commands.receipt(context, record.operationId)),
        abandon: async (context, record) => await commands.abandon(context, record.operationId),
    };
}
const operations = (context) => new OperationService(context.state);
export const gaslessDomains = (record) => [evmConflictDomain(record.intent.request.chainId, record.intent.owner.address)];
export const metaMaskGaslessDomains = (record) => [evmConflictDomain(record.intent.request.chainId, record.intent.binding.address)];
export const smartAccountGaslessDomains = (record) => [evmConflictDomain(record.intent.request.chainId, record.intent.binding.ownerAddress)];
export const facilitatorGaslessDomains = (record) => [evmConflictDomain(record.intent.request.chainId, record.intent.owner.address)];
export const gaslessTransferAdapter = gaslessAdapter("gasless_transfer", "gasless-operations", async (root, profileHash, id) => await new GaslessOperationRepository(root).loadOperation(profileHash, id), gaslessDomains, ["owner", "address"], publicGaslessOperation, {
    resumeOptions: { observationRpc: true, refuseWait: () => oneObservationOnly("Gasless") },
    status: async (context, id) => await new GaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new GaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new GaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonLocalGasless({ context, operations: operations(context), gasless: new GaslessService(context) }, id),
});
export const metaMaskGaslessAdapter = gaslessAdapter("metamask_gasless_transfer", "metamask-gasless-operations", async (root, profileHash, id) => await new MetaMaskGaslessOperationRepository(root).loadOperation(profileHash, id), metaMaskGaslessDomains, ["binding", "address"], record => publicMetaMaskGaslessOperation(record), {
    resumeOptions: { observationRpc: true, refuseWait: () => {
            throw new ApnError("APN_INVALID_INPUT", "MetaMask gasless recovery performs one bounded observation; omit --wait-seconds.", { reason: "mm_gasless_input" });
        } },
    status: async (context, id) => await new MetaMaskGaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new MetaMaskGaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new MetaMaskGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonMetaMaskGasless({ context, operations: operations(context),
        metaMaskGasless: new MetaMaskGaslessService(context) }, id),
});
export const smartAccountGaslessAdapter = gaslessAdapter("smart_account_gasless_transfer", "smart-account-gasless-operations", async (root, profileHash, id) => await new SmartAccountGaslessOperationRepository(root).loadOperation(profileHash, id), smartAccountGaslessDomains, ["binding", "ownerAddress"], publicSmartAccountGaslessOperation, {
    resumeOptions: { observationRpc: true, refuseWait: () => saFail("sa_gasless_input") },
    status: async (context, id) => await new SmartAccountGaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new SmartAccountGaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new SmartAccountGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonSmartAccountGasless(context, operations(context), id),
});
export const facilitatorGaslessAdapter = gaslessAdapter("facilitator_gasless_transfer", "facilitator-gasless-operations", async (root, profileHash, id) => await new FacilitatorGaslessOperationRepository(root).loadOperation(profileHash, id), facilitatorGaslessDomains, ["owner", "address"], publicFacilitatorOperation, {
    resumeOptions: { refuseWait: () => facilitatorFail("facilitator_gasless_input") },
    status: async (context, id) => await new FacilitatorGaslessService(context).status(id),
    resume: async (context, id) => await new FacilitatorGaslessService(context).resume(id),
    receipt: async (context, id) => await new FacilitatorGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonFacilitatorGasless({ context, operations: operations(context),
        facilitatorGasless: new FacilitatorGaslessService(context) }, id),
});
//# sourceMappingURL=gasless.js.map