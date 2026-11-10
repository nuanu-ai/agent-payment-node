import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { ApnError } from "../../errors.js";
import { facilitatorFail } from "../../facilitator-gasless/failure.js";
import { FacilitatorGaslessOperationRepository } from "../../facilitator-gasless/operation-repository.js";
import { FACILITATOR_TERMINAL } from "../../facilitator-gasless/operation-model.js";
import { publicFacilitatorOperation } from "../../facilitator-gasless/receipt.js";
import { FacilitatorGaslessService } from "../../facilitator-gasless/service.js";
import { GASLESS_TERMINAL } from "../../gasless/operation-model.js";
import { GaslessOperationRepository } from "../../gasless/operation-repository.js";
import { publicGaslessOperation } from "../../gasless/receipt.js";
import { GaslessService } from "../../gasless/service.js";
import { GASLESS_MIN_REMAINING_MS } from "../../gasless/validation.js";
import { MetaMaskGaslessOperationRepository } from "../../metamask-gasless/journal/repository.js";
import { publicMetaMaskGaslessOperation } from "../../metamask-gasless/journal/receipt.js";
import { MM_MIN_REMAINING_MS } from "../../metamask-gasless/model.js";
import { MM_TERMINAL } from "../../metamask-gasless/operation-model.js";
import { MetaMaskGaslessService } from "../../metamask-gasless/service.js";
import { abandonFacilitatorGasless, abandonLocalGasless, abandonMetaMaskGasless } from "../../operation-abandon-gasless.js";
import { abandonSmartAccountGasless } from "../../operation-abandon-provider.js";
import { EXPIRED_RELEASED_AFTER_MARGIN } from "../../operation-approval-expiry.js";
import { assertResumeOptions, oneObservationOnly } from "../../operation-command-options.js";
import { conflictDomainKey, evmConflictDomain } from "../../operation-conflict-domain.js";
import { SA_MIN_REMAINING_MS } from "../../smart-account-gasless/model.js";
import { SA_TERMINAL } from "../../smart-account-gasless/operation-model.js";
import { SmartAccountGaslessOperationRepository } from "../../smart-account-gasless/operation-repository.js";
import { OperationService } from "../../operation-service.js";
import { saFail } from "../../smart-account-gasless/reasons.js";
import { publicSmartAccountGaslessOperation } from "../../smart-account-gasless/receipt.js";
import { SmartAccountGaslessService } from "../../smart-account-gasless/service.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
import { pastUnstartedDeadline } from "./family-claims.js";
/**
 * The four gasless journals differ only in their directory, reader, outcome list (which each validator ties the record's
 * `terminal` flag to), signing-owner field, public projection, service and rules.
 */
function gaslessAdapter(family, directory, outcomes, load, domains, ownerPath, view, commands, rules) {
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
        terminal: record => {
            if (outcomes().includes(record.state))
                return true;
            const deadline = rules.unsentUntil(record);
            return deadline !== null && pastUnstartedDeadline(deadline);
        },
        state: record => record.state,
        ...(rules.admits === undefined ? {} : { admits: rules.admits }),
        salvage: raw => salvageRecord(raw, value => [salvageEvm(field(value, "intent", "request", "chainId"), field(value, "intent", ...ownerPath))]),
        view: async (record) => view(record),
        // Each family's approve can no longer finish once less than its approve margin is left before the intent's `expiresAt`
        // (status then presents it as expired and stops naming approve); the unsent record stops holding its account once the
        // unstarted margin has passed `expiresAt` (`terminal` above).
        approvalExpiry: async (record) => record.state !== "awaiting_approval" ? null
            : { deadlineMs: Date.parse(record.intent.expiresAt) - rules.approveMarginMs + 1, approveCloses: false, sealedSlot: false,
                note: EXPIRED_RELEASED_AFTER_MARGIN },
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
/** Local: the bootstrap disclosure is the first step that leaves APN; an expired undisclosed one is closed as no effect. */
const LOCAL_UNSENT = ["awaiting_approval", "execution_pending", "bootstrap_pending"];
const localUnsentUntil = (record) => LOCAL_UNSENT.includes(record.state) && record.settlement === null &&
    [record.bootstrap, record.userOperation].every(effect => effect.disclosureAttempts === 0 && effect.submissionAttempts === 0)
    ? record.intent.expiresAt : null;
/** MetaMask: the dispatch marker is written only with time left before `expiresAt`, and its delegation is signed at dispatch. */
const MM_UNSENT = ["awaiting_approval", "execution_pending"];
/**
 * A MetaMask dispatch that is over with only its outcome unknown: no APN process approves or sends it again (its
 * recovery only observes), and its effect is a one-use delegation with its own salt, redeemed by MetaMask's relayer
 * without an account nonce of the server wallet. Only another MetaMask gasless transfer of the account proceeds beside it.
 */
const MM_DISPATCHED = ["submitted_pending", "unknown_finality", "failed_effects_pending"];
/**
 * The owner's disable of one delegation is the server wallet's own transaction. A MetaMask gasless transfer sends none
 * from that wallet (MetaMask's relayer does), so a disable proceeds beside any of them, in every state.
 */
function metaMaskGaslessAdmits(record, wanted, held) {
    if (held.key !== conflictDomainKey(metaMaskGaslessDomains(record)[0]))
        return false;
    return wanted.tag?.kind === "metamask_gasless_revoke" || wanted.tag?.kind === "metamask_gasless_beside_dispatched" &&
        record.submissionAttempts === 1 && MM_DISPATCHED.includes(record.state);
}
/** Smart Account: the exposure marker is the boundary, and the child delegation itself expires on chain at `expiresAt`. */
const SA_UNSENT = ["awaiting_approval", "execution_pending", "material_pending", "material_sealed"];
/**
 * Facilitator: the verify marker is the boundary. Awaiting approval is refused past `expiresAt`; an approved one carries
 * its authorization, which can never be used past `validBefore` (it leaves APN only well before it).
 */
const facilitatorUnsentUntil = (record) => record.state === "awaiting_approval" ? record.intent.expiresAt
    : record.state === "approved" && record.signed !== null
        ? Math.max(Date.parse(record.intent.expiresAt), Number(record.signed.authorization.validBefore) * 1000) : null;
export const gaslessTransferAdapter = gaslessAdapter("gasless_transfer", "gasless-operations", () => GASLESS_TERMINAL, async (root, profileHash, id) => await new GaslessOperationRepository(root).loadOperation(profileHash, id), gaslessDomains, ["owner", "address"], publicGaslessOperation, {
    resumeOptions: { observationRpc: true, refuseWait: () => oneObservationOnly("Gasless") },
    status: async (context, id) => await new GaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new GaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new GaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonLocalGasless({ context, operations: operations(context), gasless: new GaslessService(context) }, id),
}, { unsentUntil: localUnsentUntil, approveMarginMs: GASLESS_MIN_REMAINING_MS }); // the guard before the approval prompt
export const metaMaskGaslessAdapter = gaslessAdapter("metamask_gasless_transfer", "metamask-gasless-operations", () => MM_TERMINAL, async (root, profileHash, id) => await new MetaMaskGaslessOperationRepository(root).loadOperation(profileHash, id), metaMaskGaslessDomains, ["binding", "address"], record => publicMetaMaskGaslessOperation(record), {
    resumeOptions: { observationRpc: true, refuseWait: () => {
            throw new ApnError("APN_INVALID_INPUT", "MetaMask gasless recovery performs one bounded observation; omit --wait-seconds.", { reason: "mm_gasless_input" });
        } },
    status: async (context, id) => await new MetaMaskGaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new MetaMaskGaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new MetaMaskGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonMetaMaskGasless({ context, operations: operations(context),
        metaMaskGasless: new MetaMaskGaslessService(context) }, id),
}, {
    unsentUntil: record => MM_UNSENT.includes(record.state) && record.submissionAttempts === 0 ? record.intent.expiresAt : null,
    approveMarginMs: MM_MIN_REMAINING_MS, // the dispatch check right after the approval (MetaMaskGaslessClock.beforeDispatchAtCurrent)
    admits: metaMaskGaslessAdmits,
});
export const smartAccountGaslessAdapter = gaslessAdapter("smart_account_gasless_transfer", "smart-account-gasless-operations", () => SA_TERMINAL, async (root, profileHash, id) => await new SmartAccountGaslessOperationRepository(root).loadOperation(profileHash, id), smartAccountGaslessDomains, ["binding", "ownerAddress"], publicSmartAccountGaslessOperation, {
    resumeOptions: { observationRpc: true, refuseWait: () => saFail("sa_gasless_input") },
    status: async (context, id) => await new SmartAccountGaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new SmartAccountGaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new SmartAccountGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonSmartAccountGasless(context, operations(context), id),
}, { unsentUntil: record => SA_UNSENT.includes(record.state) && record.exposureAttempts === 0 ? record.intent.expiresAt : null,
    approveMarginMs: SA_MIN_REMAINING_MS }); // the signing check right after the approval (SmartAccountGaslessClock.signing)
export const facilitatorGaslessAdapter = gaslessAdapter("facilitator_gasless_transfer", "facilitator-gasless-operations", () => FACILITATOR_TERMINAL, async (root, profileHash, id) => await new FacilitatorGaslessOperationRepository(root).loadOperation(profileHash, id), facilitatorGaslessDomains, ["owner", "address"], publicFacilitatorOperation, {
    resumeOptions: { refuseWait: () => facilitatorFail("facilitator_gasless_input") },
    status: async (context, id) => await new FacilitatorGaslessService(context).status(id),
    resume: async (context, id) => await new FacilitatorGaslessService(context).resume(id),
    receipt: async (context, id) => await new FacilitatorGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonFacilitatorGasless({ context, operations: operations(context),
        facilitatorGasless: new FacilitatorGaslessService(context) }, id),
}, { unsentUntil: facilitatorUnsentUntil, approveMarginMs: 1 }); // approve refuses from `expiresAt` on (FacilitatorExecution.expired)
//# sourceMappingURL=gasless.js.map