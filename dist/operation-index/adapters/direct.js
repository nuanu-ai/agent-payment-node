import { assertCoinbaseObservationRequest } from "../../coinbase-gasless-observation-source.js";
import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { DirectPublicEffectJournal } from "../../direct-public-effect.js";
import { SETTLED_DIRECT_STATES } from "../../direct-transfer-settle.js";
import { ApnError } from "../../errors.js";
import { LOCAL_DIRECT_TERMINAL_STATES, PROVIDER_DIRECT_TERMINAL_STATES } from "../../model.js";
import { abandonDirectTransfer } from "../../operation-abandon-service.js";
import { EXPIRED_APPROVE_CLOSES, EXPIRED_APPROVE_OR_NEXT_TRANSFER_CLOSES, EXPIRED_EVIDENCE_MISSING, EXPIRED_EVIDENCE_UNREADABLE, EXPIRED_EVIDENCE_UNVERIFIED, EXPIRED_NEXT_TRANSFER_CLOSES } from "../../operation-approval-expiry.js";
import { refuseObservationRpc, refuseObserveOnly } from "../../operation-command-options.js";
import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { StateStore } from "../../state.js";
import { publicOperation } from "../../transfer-policy.js";
import { TransferService } from "../../transfer-service.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageHash, salvageRecord, standardIdentity } from "../adapter.js";
import { providerClaims, UNREADABLE_PROVIDER_CLAIM } from "../types.js";
const STORE = { directory: "operations", perProfile: true };
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
/**
 * The family's own outcome list for its kind (local or provider): the same list each validator ties the record's
 * `terminal` flag to. The Base USDC local record (no `evm` binding) has no such check on read, so its state decides.
 */
export function directTerminal(record) {
    return (record.providerDirect === undefined ? LOCAL_DIRECT_TERMINAL_STATES : PROVIDER_DIRECT_TERMINAL_STATES).includes(record.state);
}
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
/**
 * Null when local approve reaches its deadline check and closes the record; otherwise the note for its refusal. Approve's own
 * order (TransferService.approveOperation): a generic EVM record without its frozen native custody refuses first, then
 * DirectPublicEffectJournal.assertUnstarted checks the prepared binding, custody and wallet file. Reads only. Every refusal it
 * makes on what the state holds is an ApnError (blocked, corrupt, drift, an unsafe file, an out-of-range number), and approve
 * stops at the same one. A failure that is not an ApnError (the file system's own, such as EACCES or EIO) proves nothing
 * either way, so it gets its own note.
 */
async function localApproveRefusal(record, root) {
    if (record.evm !== undefined && record.evm.nativeCustody === undefined)
        return EXPIRED_EVIDENCE_UNVERIFIED;
    try {
        await new DirectPublicEffectJournal(new StateStore(root)).assertUnstarted(record);
        return null;
    }
    catch (error) {
        if (!(error instanceof ApnError))
            return EXPIRED_EVIDENCE_UNREADABLE;
        return error.details?.reason === "direct_public_evidence_missing" ? EXPIRED_EVIDENCE_MISSING : EXPIRED_EVIDENCE_UNVERIFIED;
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
    terminal: directTerminal,
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [
        salvageEvm(field(value, "chainId"), field(value, "walletAddress")),
        ...(field(value, "providerDirect") === undefined ? [] : salvageProvider(field(value, "providerDirect", "providerId"), field(value, "providerDirect", "accountBindingHash"), field(value, "walletAddress"))),
    ]),
    unknownClaims: [UNREADABLE_PROVIDER_CLAIM],
    view: async (record) => publicOperation(record),
    // Provider and local approve both close the record from `expiresAt` on (approval_window_expired) before any prompt; a local
    // EVM transfer is also closed by the profile's next transfer on its chain. A local transfer is closed only once
    // DirectPublicEffectJournal.assertUnstarted accepts its evidence, so status runs that same read-only check: where it
    // refuses, approve and that retirement refuse too, and approve is not named.
    async approvalExpiry(record, root) {
        if (record.state !== "awaiting_approval")
            return null;
        const expiry = (approveCloses, note) => ({ deadlineMs: Date.parse(record.expiresAt), approveCloses, sealedSlot: false, note });
        if (record.providerDirect !== undefined)
            return expiry(true, EXPIRED_APPROVE_CLOSES);
        const refusal = await localApproveRefusal(record, root);
        if (refusal !== null)
            return expiry(false, refusal);
        if (record.evm === undefined)
            return expiry(true, EXPIRED_APPROVE_CLOSES);
        // The retired cleanup85 cancellation is read-only to approve; the profile's next transfer on its chain still retires it.
        return record.evm.cleanup85Cancellation === undefined ? expiry(true, EXPIRED_APPROVE_OR_NEXT_TRANSFER_CLOSES)
            : expiry(false, EXPIRED_NEXT_TRANSFER_CLOSES);
    },
    status: async (context, record) => operationOutcome(await new TransferService(context).status(record.operationId)),
    // The terminal receipt's authority over its operation is checked here, by the one command that returns it.
    receipt: async (context, record) => receiptOutcome(await new TransferService(context).receipt(record.operationId)),
    async resume(context, record, options) {
        if (options.coinbaseObservationRpc !== undefined)
            assertCoinbaseObservationRequest(record, options.coinbaseObservationRpc, options.observeOnly !== undefined || options.waitSeconds !== undefined || options.observationRpcEnv !== undefined);
        if (options.observeOnly && record.providerDirect !== undefined)
            refuseObserveOnly();
        if (options.observationRpcEnv !== undefined)
            refuseObservationRpc();
        return operationOutcome(await new TransferService(context).resume(record.operationId, options.waitSeconds, options.observeOnly, options.coinbaseObservationRpc));
    },
    abandon: async (context, record) => await abandonDirectTransfer(context, record.operationId),
    // The blocker settle: a dispatched local transfer is observed once (receipt, then never-lands) and never dispatched
    // again, over the refused command's RPC only once a standalone chain-id read proved it serves the transfer's chain.
    async settleIfNeverLands(context, record) {
        if (record.providerDirect !== undefined || !SETTLED_DIRECT_STATES.includes(record.state))
            return null;
        const settled = await new TransferService(context).settleDispatched(record.operationId);
        return directTerminal(settled) ? settled.proofClass : null;
    },
    // Status only reads a local transfer; a dispatched one is observed by its own next action, resume (which re-sends
    // only its own signed bytes). No other state is advanced by it.
    observeCommand: record => record.providerDirect === undefined && SETTLED_DIRECT_STATES.includes(record.state)
        ? "apn operation resume --operation <operation-id> --rpc-url <https-url>" : undefined,
};
//# sourceMappingURL=direct.js.map